import type {
  StorageAdapter, ConsentManagerAdapter, ConsentManagerEvent, ConsentManagerArtefact, ConsentManagerArtefactRecord,
  CategoryMap, Profile, EntityListOptions, ConsentReceiptAction,
} from '@consenti/types'
import { createHash } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { AuditRepo } from '../repositories/audit.repo'
import type { ReceiptService } from './receipt.service'

export class ConsentManagerError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409) { super(message) }
}

const MAX_ID = 200
const EVENT_TYPES = ['consent.granted', 'consent.updated', 'consent.withdrawn'] as const
const STATUSES = ['active', 'withdrawn', 'expired'] as const
const RECEIPT_ACTION: Record<ConsentManagerEvent['type'], ConsentReceiptAction> = {
  'consent.granted': 'given', 'consent.updated': 'updated', 'consent.withdrawn': 'withdrawn',
}

/** Checks an event an adapter returned: the adapter authenticates, Ijazat still validates. */
export function validateConsentManagerEvent(input: unknown): ConsentManagerEvent {
  const bad = (m: string): never => { throw new ConsentManagerError(`Invalid notification: ${m}`, 400) }
  if (!input || typeof input !== 'object') bad('not an object')
  const e = input as Record<string, unknown>
  if (!EVENT_TYPES.includes(e['type'] as never)) bad('type')
  const a = e['artefact'] as Record<string, unknown> | undefined
  if (!a || typeof a !== 'object') bad('artefact')
  const str = (k: string, required = true) => {
    const v = a![k]
    if (v === undefined && !required) return
    if (typeof v !== 'string' || !v || v.length > MAX_ID) bad(`artefact.${k}`)
  }
  str('artefactId'); str('principalRef'); str('noticeVersion', false)
  if (!STATUSES.includes(a!['status'] as never)) bad('artefact.status')
  for (const k of ['givenAt', 'expiresAt']) {
    const v = a![k]
    if (v === undefined && k === 'expiresAt') continue
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad(`artefact.${k}`)
  }
  const purposes = a!['purposes']
  if (!Array.isArray(purposes) || purposes.length > 50) bad('artefact.purposes')
  for (const p of purposes as unknown[]) {
    const o = p as Record<string, unknown>
    if (!o || typeof o['id'] !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(o['id']) || (o['status'] !== 'granted' && o['status'] !== 'denied')) bad('artefact.purposes[]')
  }
  return input as ConsentManagerEvent
}

/** Item-level decisions for an artefact: mandatory purposes on, granted purposes on while the
 * artefact is active, everything else off. */
export function consentFromArtefact(artefact: ConsentManagerArtefact, categories: CategoryMap): Record<string, string> {
  const granted = new Set(artefact.status === 'active' ? artefact.purposes.filter(p => p.status === 'granted').map(p => p.id) : [])
  const out: Record<string, string> = {}
  for (const [id, cat] of Object.entries(categories)) {
    const on = cat.legalBasis === 'mandatory' || granted.has(id)
    for (const c of cat.cookies) out[c] = on ? 'granted' : 'denied'
  }
  return out
}

/**
 * Receives Consent Manager notifications through an adapter, records the artefact and a consent
 * receipt (source `consent_manager:<id>`), and emits `consent_manager:event` so the site can act on
 * it, above all on withdrawal. People are identified only by a hash of the Consent Manager's
 * opaque reference. TODO(legal): Q-M1 to Q-M3.
 */
export class ConsentManagerService {
  private adapters: Map<string, ConsentManagerAdapter>

  constructor(
    private storage: StorageAdapter,
    private audit: AuditRepo,
    private receipts: ReceiptService,
    private dpdpProfile: (tenantId: string) => Promise<{ profile: Profile; categories: CategoryMap } | null>,
    adapters: readonly ConsentManagerAdapter[] = [],
    private eventBus?: EventEmitter,
  ) {
    this.adapters = new Map(adapters.map(a => [a.id, a]))
    if (this.adapters.size !== adapters.length) throw new Error('Consent Manager adapter IDs must be unique')
    for (const id of this.adapters.keys()) if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`Invalid Consent Manager adapter ID "${id}"`)
  }

  listAdapters(): { id: string; name: string }[] {
    return [...this.adapters.values()].map(a => ({ id: a.id, name: a.name }))
  }

  async handleNotification(
    tenantId: string, adapterId: string, request: { headers: Record<string, string>; body: string },
  ): Promise<ConsentManagerArtefactRecord> {
    const adapter = this.adapters.get(adapterId)
    if (!adapter) throw new ConsentManagerError('Unknown Consent Manager', 404)
    let raw: unknown
    try {
      raw = await adapter.verifyNotification(request)
    } catch {
      throw new ConsentManagerError('Notification could not be verified', 401)
    }
    const event = validateConsentManagerEvent(raw)
    const target = await this.dpdpProfile(tenantId)
    if (!target) throw new ConsentManagerError('This site has no active DPDP profile to map purposes to', 409)

    const { artefact } = event
    const id = `cma_${createHash('sha256').update(`${tenantId}|${adapterId}|${artefact.artefactId}`).digest('hex').slice(0, 40)}`
    const existing = await this.storage.getEntity(tenantId, 'cm_artefact', id) as unknown as ConsentManagerArtefactRecord | null
    if (existing && JSON.stringify(existing.data.artefact) === JSON.stringify(artefact)) return existing // a retried notification

    const consent = consentFromArtefact(artefact, target.categories)
    const principal = `cm:${adapterId}:${artefact.principalRef}`
    const now = new Date().toISOString()
    const record: ConsentManagerArtefactRecord = {
      id, tenantId, collection: 'cm_artefact', ref: this.receipts.visitorRef(tenantId, principal), status: artefact.status,
      dueAt: artefact.expiresAt ? new Date(artefact.expiresAt).toISOString() : null,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
      data: {
        adapterId, artefact, consent, profileId: target.profile.id,
        history: [...(existing?.data.history ?? []), { at: now, type: event.type, status: artefact.status }],
      },
    }
    await this.storage.putEntity(record)
    await this.receipts.record({
      tenantId, visitorId: principal, action: artefact.status === 'active' ? RECEIPT_ACTION[event.type] : artefact.status === 'expired' ? 'expired' : 'withdrawn',
      record: null, profile: target.profile, categories: target.categories,
      consent, source: `consent_manager:${adapterId}`,
      ...(artefact.noticeVersion ? { noticeVersion: artefact.noticeVersion } : {}),
    })
    await this.audit.log({
      tenantId, action: `consent_manager:${event.type}`, resourceType: 'cm_artefact', resourceId: id,
      newData: { adapterId, status: artefact.status, purposes: artefact.purposes },
    })
    this.eventBus?.emit('consent_manager:event', {
      tenantId, adapterId, type: event.type, artefactId: artefact.artefactId, principalRef: artefact.principalRef,
      status: artefact.status, consent,
    })
    return record
  }

  async list(tenantId: string, status: string | undefined, options: EntityListOptions = {}): Promise<{ items: ConsentManagerArtefactRecord[]; total: number }> {
    const filter = { tenantId, collection: 'cm_artefact' as const, ...(status ? { status } : {}) }
    const [items, total] = await Promise.all([this.storage.listEntities(filter, options), this.storage.countEntities(filter)])
    return { items: items as unknown as ConsentManagerArtefactRecord[], total }
  }
}
