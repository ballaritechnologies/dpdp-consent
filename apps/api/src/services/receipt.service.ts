import type {
  StorageAdapter, ConsentDbRecord, Profile, CategoryMap, ServerConsentReceipt, ConsentReceiptAction,
  ConsentReceiptData, PurposeState, EntityFilter, EntityListOptions,
} from '@consenti/types'
import { buildCookieCategoryIndex, isMandatoryCookie } from '@consenti/utils'
import { signHmac, verifyHmac } from '../utils/crypto'

/** What ConsentService hands over after each write. */
import { sortableEntityId } from '../storage/entity-sql'
export interface ReceiptEvent {
  tenantId: string
  visitorId: string
  action: ConsentReceiptAction
  record: ConsentDbRecord | null
  profile: Profile | null
  categories: CategoryMap
  previous?: ConsentDbRecord | null
  expiredPurposes?: string[]
  minor?: ConsentReceiptData['minor']
  /** Overrides for decisions that don't come from a consent record (e.g. a Consent Manager). */
  consent?: Record<string, string>
  source?: string
  noticeVersion?: string
}

/** The part of ReceiptService that ConsentService depends on. */
export interface ReceiptWriter {
  record(event: ReceiptEvent): Promise<ServerConsentReceipt>
}

/**
 * Consent receipts: one signed, append-only entry per consent decision (given, changed, withdrawn,
 * lapsed or erased), holding the purposes, the notice version, the language and the time. The
 * visitor is identified only by an HMAC of their visitor ID, so receipts carry no raw identifier
 * and survive erasure of the consent record as evidence of what was decided.
 * TODO(legal): Q-P1 — confirm that keeping pseudonymous receipts after erasure is acceptable.
 */
export class ReceiptService implements ReceiptWriter {
  constructor(private storage: StorageAdapter, private secret: string) {
    if (!secret) throw new Error('ReceiptService needs the data-signing secret')
  }

  /** Stable pseudonym for a visitor ID; the same input always maps to the same ref. */
  visitorRef(visitorId: string): string {
    return signHmac(`ijazat:visitor:${visitorId}`, this.secret)
  }

  async record(e: ReceiptEvent): Promise<ServerConsentReceipt> {
    const now = new Date().toISOString()
    const consent = { ...(e.consent ?? e.record?.consentJson ?? {}) }
    const purposes = purposeStates(e.categories, consent)
    let action = e.action
    if (action === 'updated' && e.previous && hadOptionalGrant(e.previous.consentJson, e.categories) && !hadOptionalGrant(consent, e.categories)) {
      action = 'withdrawn'
    }
    const pj = e.profile?.profileJson
    const unsigned: Omit<ConsentReceiptData, 'signature'> = {
      receiptVersion: 1,
      action,
      consentRecordId: e.record?.id ?? e.previous?.id ?? null,
      profileId: e.record?.profileId ?? e.previous?.profileId ?? e.profile?.id ?? null,
      profileVersion: e.record?.profileVersion ?? e.previous?.profileVersion ?? e.profile?.version ?? null,
      noticeVersion: e.noticeVersion ?? pj?.dpdpa?.noticeVersion ?? null,
      complianceGroup: pj?.complianceGroup ?? null,
      regulation: pj?.regulation ?? null,
      locale: e.record?.locale ?? e.previous?.locale ?? null,
      source: e.source ?? e.record?.source ?? null,
      gpcDetected: e.record?.gpcDetected ?? false,
      purposes,
      consent,
      ...(e.expiredPurposes?.length ? { expiredPurposes: [...e.expiredPurposes] } : {}),
      ...(e.minor ? { minor: e.minor } : {}),
    }
    const ref = this.visitorRef(e.visitorId)
    const receipt: ServerConsentReceipt = {
      id: sortableEntityId('rcpt'),
      tenantId: e.tenantId,
      collection: 'consent_receipt',
      ref,
      status: action,
      dueAt: null,
      createdAt: now,
      updatedAt: now,
      data: { ...unsigned, signature: signHmac(receiptPayload(e.tenantId, ref, now, unsigned), this.secret) },
    }
    await this.storage.putEntity(receipt)
    return receipt
  }

  /** True when the receipt is unchanged since it was written. */
  verify(r: ServerConsentReceipt): boolean {
    const { signature, ...rest } = r.data
    if (!r.ref || typeof signature !== 'string') return false
    return verifyHmac(receiptPayload(r.tenantId, r.ref, r.createdAt, rest), signature, this.secret)
  }

  async forVisitor(tenantId: string, visitorId: string, options: EntityListOptions = {}): Promise<ServerConsentReceipt[]> {
    return this.list({ tenantId, collection: 'consent_receipt', ref: this.visitorRef(visitorId) }, options)
  }

  async list(filter: EntityFilter, options: EntityListOptions = {}): Promise<ServerConsentReceipt[]> {
    return await this.storage.listEntities({ ...filter, collection: 'consent_receipt' }, options) as unknown as ServerConsentReceipt[]
  }

  count(filter: EntityFilter): Promise<number> {
    return this.storage.countEntities({ ...filter, collection: 'consent_receipt' })
  }
}

/** Canonical, key-sorted JSON so the signature doesn't depend on property order or driver. */
function receiptPayload(tenantId: string, ref: string, createdAt: string, data: Omit<ConsentReceiptData, 'signature'>): string {
  return canonical({ tenantId, ref, createdAt, data })
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export function purposeStates(categories: CategoryMap, consent: Record<string, string>): Record<string, PurposeState> {
  const out: Record<string, PurposeState> = {}
  for (const [id, cat] of Object.entries(categories)) {
    const items = cat.cookies ?? []
    if (items.length === 0) continue
    const granted = items.filter(c => consent[c] === 'granted').length
    out[id] = granted === 0 ? 'denied' : granted === items.length ? 'granted' : 'partial'
  }
  return out
}

function hadOptionalGrant(consent: Record<string, string>, categories: CategoryMap): boolean {
  const index = buildCookieCategoryIndex(categories)
  return Object.entries(consent).some(([id, v]) => v === 'granted' && index.has(id) && !isMandatoryCookie(id, index))
}
