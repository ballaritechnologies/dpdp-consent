import type {
  StorageAdapter, ParentalConsentProvider, ParentalConsentRequest, ParentalConsentStatus, EntityListOptions,
} from '@consenti/types'
import type { AuditRepo } from '../repositories/audit.repo'
import { sortableEntityId } from '../storage/entity-sql'

export class ParentalConsentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502) { super(message) }
}

type Source = ParentalConsentRequest['data']['history'][number]['source']

/**
 * Parental-consent requests for children (visitors who answered the age gate as under age).
 * Ijazat records each request and its outcome; verification itself is done by the configured
 * `ParentalConsentProvider`, by the site through the signed parental-consent token, or by staff
 * in the dashboard. Visitors are identified only by a hashed visitor ID.
 * TODO(legal): Q-C3 — what counts as verifiable parental consent, including manual verification.
 */
export class ParentalConsentService {
  constructor(
    private storage: StorageAdapter,
    private audit: AuditRepo,
    private visitorRef: (tenantId: string, visitorId: string) => string,
    private provider?: ParentalConsentProvider,
  ) { }

  get providerId(): string | null {
    return this.provider?.id ?? null
  }

  async request(tenantId: string, visitorId: string, profileId: string, locale: string | null): Promise<ParentalConsentRequest> {
    const now = new Date().toISOString()
    const ref = this.visitorRef(tenantId, visitorId)
    let req: ParentalConsentRequest = {
      id: sortableEntityId('pcr'), tenantId, collection: 'parental_consent', ref, status: 'pending', dueAt: null,
      createdAt: now, updatedAt: now,
      data: {
        profileId, locale, providerId: this.provider?.id ?? null, providerRef: null, method: null,
        redirectUrl: null, message: null,
        history: [{ at: now, status: 'pending', source: 'request', actorId: null, note: null }],
      },
    }
    if (this.provider) {
      let result
      try {
        result = await this.provider.start({ requestId: req.id, tenantId, visitorRef: ref, profileId, locale })
      } catch (err) {
        throw new ParentalConsentError(`Parental-consent provider failed: ${err instanceof Error ? err.message : String(err)}`, 502)
      }
      req = {
        ...req,
        status: result.status,
        data: {
          ...req.data, providerRef: result.providerRef, method: result.method ?? null,
          redirectUrl: safeRedirect(result.redirectUrl), message: result.message ?? null,
          history: result.status === 'pending' ? req.data.history : [...req.data.history, { at: now, status: result.status, source: 'provider', actorId: null, note: null }],
        },
      }
    }
    await this.storage.putEntity(req)
    await this.audit.log({
      tenantId, action: 'parental_consent:requested', resourceType: 'parental_consent', resourceId: req.id,
      newData: { profileId, provider: this.provider?.id ?? null, status: req.status },
    })
    return req
  }

  /** The visitor's latest request, refreshed from the provider while pending. */
  async latest(tenantId: string, visitorId: string): Promise<ParentalConsentRequest | null> {
    const [req] = await this.storage.listEntities(
      { tenantId, collection: 'parental_consent', ref: this.visitorRef(tenantId, visitorId) }, { limit: 1 },
    ) as unknown as ParentalConsentRequest[]
    if (!req) return null
    if (req.status !== 'pending' || !this.provider || !req.data.providerRef || req.data.providerId !== this.provider.id) return req
    let result
    try {
      result = await this.provider.check(req.data.providerRef)
    } catch {
      return req // provider unreachable: report what we know
    }
    if (result.status === 'pending') return req
    return this.setStatus(req, result.status, 'provider', null, null, result.method ?? req.data.method)
  }

  async isParentVerified(tenantId: string, visitorId: string): Promise<boolean> {
    return (await this.latest(tenantId, visitorId))?.status === 'verified'
  }

  /** The site verified the parent through its own flow and resolved the signed token. */
  async verifyByToken(tenantId: string, visitorId: string, profileId: string): Promise<ParentalConsentRequest> {
    const req = await this.latest(tenantId, visitorId) ?? await this.request(tenantId, visitorId, profileId, null)
    if (req.status === 'verified') return req
    return this.setStatus(req, 'verified', 'token', null, null, 'site_token')
  }

  /** Staff record an outcome verified outside Ijazat (e.g. a signed form). */
  async decide(tenantId: string, id: string, status: ParentalConsentStatus, actorId: string, note: string | null): Promise<ParentalConsentRequest> {
    if (status !== 'verified' && status !== 'failed') throw new ParentalConsentError('status must be verified or failed', 400)
    if (note !== null && (typeof note !== 'string' || note.length > 2000)) throw new ParentalConsentError('note must be a string of at most 2000 characters', 400)
    const req = await this.storage.getEntity(tenantId, 'parental_consent', id) as unknown as ParentalConsentRequest | null
    if (!req) throw new ParentalConsentError('Parental-consent request not found', 404)
    if (req.status !== 'pending') throw new ParentalConsentError(`This request is already ${req.status}`, 409)
    return this.setStatus(req, status, 'dashboard', actorId, note, status === 'verified' ? 'manual' : req.data.method)
  }

  async list(tenantId: string, status: string | undefined, options: EntityListOptions = {}): Promise<{ items: ParentalConsentRequest[]; total: number }> {
    const filter = { tenantId, collection: 'parental_consent' as const, ...(status ? { status } : {}) }
    const [items, total] = await Promise.all([this.storage.listEntities(filter, options), this.storage.countEntities(filter)])
    return { items: items as unknown as ParentalConsentRequest[], total }
  }

  private async setStatus(
    req: ParentalConsentRequest, status: ParentalConsentStatus, source: Source, actorId: string | null, note: string | null, method: string | null,
  ): Promise<ParentalConsentRequest> {
    const at = new Date().toISOString()
    const next: ParentalConsentRequest = {
      ...req, status, updatedAt: at,
      data: { ...req.data, method, history: [...req.data.history, { at, status, source, actorId, note }] },
    }
    await this.storage.putEntity(next)
    await this.audit.log({
      tenantId: req.tenantId, ...(actorId ? { userId: actorId } : {}),
      action: 'parental_consent:status_changed', resourceType: 'parental_consent', resourceId: req.id,
      oldData: { status: req.status }, newData: { status, source, method },
    })
    return next
  }
}

function safeRedirect(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
