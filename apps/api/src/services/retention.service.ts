import type {
  StorageAdapter, RetentionPolicy, RetentionRunResult, CategoryMap, ConsentDbRecord, ConsentValue,
  ServerConsentReceipt, EntityRecord,
} from '@consenti/types'
import { buildCookieCategoryIndex, isMandatoryCookie } from '@consenti/utils'
import type { EventEmitter } from 'node:events'
import type { AuditRepo } from '../repositories/audit.repo'
import type { ReceiptService } from './receipt.service'

const MAX_DAYS = 36_500
const DAY = 86_400_000

export class RetentionPolicyError extends Error { }

/** What RetentionService needs from ConsentService. */
export interface RetentionConsentOps {
  purposesFor(profileId: string): Promise<CategoryMap | null>
  update(
    visitorId: string,
    input: { consentJson: ConsentValue },
    receipt: { action: 'expired'; expiredPurposes: string[] },
  ): Promise<ConsentDbRecord>
}

function policyId(tenantId: string): string {
  return `retention_policy:${tenantId}`
}

/** Checks a policy from the admin API; returns it with only known, valid fields. */
export function validateRetentionPolicy(input: unknown): RetentionPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RetentionPolicyError('Policy must be an object')
  const o = input as Record<string, unknown>
  const days = (v: unknown, field: string): number | undefined => {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_DAYS) {
      throw new RetentionPolicyError(`${field} must be a whole number of days from 1 to ${MAX_DAYS}`)
    }
    return v
  }
  const out: RetentionPolicy = {}
  if (o['purposeExpiryDays'] !== undefined && o['purposeExpiryDays'] !== null) {
    const p = o['purposeExpiryDays']
    if (typeof p !== 'object' || Array.isArray(p)) throw new RetentionPolicyError('purposeExpiryDays must map purpose IDs to days')
    const map: Record<string, number> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(k)) throw new RetentionPolicyError(`Invalid purpose ID: ${k}`)
      map[k] = days(v, `purposeExpiryDays.${k}`)!
    }
    if (Object.keys(map).length) out.purposeExpiryDays = map
  }
  for (const f of ['receiptDays', 'closedErasureRequestDays', 'erasureResponseDays'] as const) {
    const v = days(o[f], f)
    if (v !== undefined) out[f] = v
  }
  return out
}

/**
 * Purpose-based retention. Each run:
 *  1. switches off any granted purpose older than its expiry period (measured from when the visitor
 *     last switched it on, read from their receipts), writing an `expired` receipt;
 *  2. deletes consent receipts older than `receiptDays`;
 *  3. deletes closed erasure requests made more than `closedErasureRequestDays` ago.
 * With `dryRun` nothing changes and the result says what would.
 * TODO(legal): Q-P3 — confirm retention periods per purpose before relying on them.
 */
export class RetentionService {
  constructor(
    private storage: StorageAdapter,
    private consentsFor: (tenantId: string) => RetentionConsentOps,
    private receipts: ReceiptService,
    private audit: AuditRepo,
    private eventBus?: EventEmitter,
  ) { }

  async getPolicy(tenantId: string): Promise<RetentionPolicy> {
    const e = await this.storage.getEntity(tenantId, 'retention_policy', policyId(tenantId))
    return (e?.data as RetentionPolicy | undefined) ?? {}
  }

  async setPolicy(tenantId: string, input: unknown, actorId?: string): Promise<RetentionPolicy> {
    const policy = validateRetentionPolicy(input)
    const old = await this.getPolicy(tenantId)
    const now = new Date().toISOString()
    const existing = await this.storage.getEntity(tenantId, 'retention_policy', policyId(tenantId))
    const record: EntityRecord<RetentionPolicy> = {
      id: policyId(tenantId), tenantId, collection: 'retention_policy', ref: null, status: null, dueAt: null,
      createdAt: existing?.createdAt ?? now, updatedAt: now, data: policy,
    }
    await this.storage.putEntity(record)
    await this.audit.log({
      tenantId, ...(actorId ? { userId: actorId } : {}),
      action: 'retention:policy_updated', resourceType: 'retention_policy', resourceId: record.id,
      oldData: old, newData: policy,
    })
    return policy
  }

  async run(tenantId: string, opts: { dryRun?: boolean; now?: Date; actorId?: string } = {}): Promise<RetentionRunResult> {
    const dryRun = opts.dryRun === true
    const now = opts.now ?? new Date()
    const policy = await this.getPolicy(tenantId)
    const result: RetentionRunResult = { dryRun, ranAt: now.toISOString(), expired: [], receiptsDeleted: 0, erasureRequestsDeleted: 0 }

    const consents = this.consentsFor(tenantId)
    const expiry = policy.purposeExpiryDays ?? {}
    const minDays = Math.min(...Object.values(expiry))
    if (Number.isFinite(minDays)) {
      // Collect first, change after: some drivers stream from a live cursor.
      const candidates: ConsentDbRecord[] = []
      const createdCutoff = new Date(now.getTime() - minDays * DAY).toISOString()
      for await (const c of this.storage.streamConsents({ tenantId })) {
        if (c.createdAt < createdCutoff) candidates.push(c)
      }
      const purposeCache = new Map<string, CategoryMap | null>()
      for (const record of candidates) {
        if (!purposeCache.has(record.profileId)) purposeCache.set(record.profileId, await consents.purposesFor(record.profileId))
        const categories = purposeCache.get(record.profileId)
        if (!categories) continue
        const lapsed = await this.lapsedPurposes(tenantId, record, categories, expiry, now)
        if (lapsed.length === 0) continue
        result.expired.push({ visitorRef: this.receipts.visitorRef(record.visitorId), purposes: lapsed })
        if (dryRun) continue
        const consentJson: ConsentValue = { ...record.consentJson }
        for (const p of lapsed) for (const cookie of categories[p]?.cookies ?? []) consentJson[cookie] = 'denied'
        await consents.update(record.visitorId, { consentJson }, { action: 'expired', expiredPurposes: lapsed })
        this.eventBus?.emit('consent:purposes_expired', { tenantId, visitorId: record.visitorId, purposes: lapsed })
      }
    }

    if (policy.receiptDays) {
      const filter = { tenantId, collection: 'consent_receipt' as const, createdBefore: new Date(now.getTime() - policy.receiptDays * DAY).toISOString() }
      result.receiptsDeleted = dryRun ? await this.storage.countEntities(filter) : await this.storage.deleteEntities(filter)
    }

    // TODO(legal): Q-P4 — how long proof of a handled request (with contact details) may be kept.
    if (policy.closedErasureRequestDays) {
      const createdBefore = new Date(now.getTime() - policy.closedErasureRequestDays * DAY).toISOString()
      for (const status of ['completed', 'rejected']) {
        const filter = { tenantId, collection: 'erasure_request' as const, status, createdBefore }
        result.erasureRequestsDeleted += dryRun ? await this.storage.countEntities(filter) : await this.storage.deleteEntities(filter)
      }
    }

    if (!dryRun && (result.expired.length || result.receiptsDeleted || result.erasureRequestsDeleted)) {
      await this.audit.log({
        tenantId, ...(opts.actorId ? { userId: opts.actorId } : {}),
        action: 'retention:run', resourceType: 'retention_policy', resourceId: policyId(tenantId),
        newData: { expiredVisitors: result.expired.length, receiptsDeleted: result.receiptsDeleted, erasureRequestsDeleted: result.erasureRequestsDeleted },
      })
    }
    return result
  }

  /** Optional purposes still on whose expiry period has passed since they were last switched on. */
  private async lapsedPurposes(
    tenantId: string, record: ConsentDbRecord, categories: CategoryMap, expiry: Record<string, number>, now: Date,
  ): Promise<string[]> {
    const index = buildCookieCategoryIndex(categories)
    const on = Object.keys(expiry).filter(p => {
      const cookies = categories[p]?.cookies ?? []
      return cookies.some(c => record.consentJson[c] === 'granted' && !isMandatoryCookie(c, index))
    })
    if (on.length === 0) return []
    const since = await this.grantedSince(tenantId, record, on)
    return on.filter(p => (since[p] ?? record.updatedAt) < new Date(now.getTime() - expiry[p]! * DAY).toISOString())
  }

  /** When each purpose was last switched on, from the visitor's receipts (oldest first). */
  private async grantedSince(tenantId: string, record: ConsentDbRecord, purposes: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    const prev: Record<string, boolean> = {}
    let offset = 0
    for (;;) {
      const page: ServerConsentReceipt[] = await this.receipts.forVisitor(tenantId, record.visitorId, { order: 'asc', limit: 500, offset })
      for (const r of page) {
        for (const p of purposes) {
          const isOn = r.data.purposes[p] === 'granted' || r.data.purposes[p] === 'partial'
          if (isOn && !prev[p]) out[p] = r.createdAt
          prev[p] = isOn
        }
      }
      if (page.length < 500) break
      offset += page.length
    }
    return out
  }
}
