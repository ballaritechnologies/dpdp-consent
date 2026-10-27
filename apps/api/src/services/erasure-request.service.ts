import type {
  StorageAdapter, ErasureRequest, ErasureRequestStatus, ErasureRequestChannel, EntityFilter,
  EntityListOptions, RetentionPolicy,
} from '@consenti/types'
import type { AuditRepo } from '../repositories/audit.repo'

/** Default days a new request is due in. TODO(legal): Q-P2 — confirm the response period to use. */
import { sortableEntityId } from '../storage/entity-sql'
export const DEFAULT_ERASURE_RESPONSE_DAYS = 30

export const ERASURE_STATUSES: readonly ErasureRequestStatus[] = ['received', 'verifying', 'in_progress', 'completed', 'rejected']
export const ERASURE_CHANNELS: readonly ErasureRequestChannel[] = ['widget', 'email', 'dashboard', 'api', 'other']
export const OPEN_ERASURE_STATUSES: readonly ErasureRequestStatus[] = ['received', 'verifying', 'in_progress']

const NEXT: Record<ErasureRequestStatus, readonly ErasureRequestStatus[]> = {
  received: ['verifying', 'in_progress', 'completed', 'rejected'],
  verifying: ['in_progress', 'completed', 'rejected'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
}

export const MAX_CONTACT_LENGTH = 254
export const MAX_MESSAGE_LENGTH = 2000

export class ErasureRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message) }
}

export interface NewErasureRequest {
  tenantId: string
  channel: ErasureRequestChannel
  visitorId?: string | null
  contact?: string | null
  message?: string | null
  actorId?: string | null
}

export interface ErasureTransition {
  status: ErasureRequestStatus
  note?: string | null
  actorId?: string | null
  /** With `completed`: also erase the visitor's consent record (needs a visitor ID on the request). */
  eraseConsent?: boolean
}

/**
 * Deletion-request inbox: requests from visitors (widget), email or the dashboard, each with a due
 * date, a status and a history of who changed it. Completing a request can erase the visitor's
 * consent record in the same step. Every change is written to the audit log (without the
 * requester's contact details or message).
 */
export class ErasureRequestService {
  constructor(
    private storage: StorageAdapter,
    private audit: AuditRepo,
    private visitorRef: (visitorId: string) => string,
    private eraseConsent: (tenantId: string, visitorId: string) => Promise<void>,
    private policy: (tenantId: string) => Promise<RetentionPolicy>,
  ) { }

  async create(input: NewErasureRequest): Promise<ErasureRequest> {
    if (!ERASURE_CHANNELS.includes(input.channel)) throw new ErasureRequestError('Invalid channel', 400)
    const contact = clean(input.contact, MAX_CONTACT_LENGTH, 'contact')
    const message = clean(input.message, MAX_MESSAGE_LENGTH, 'message')
    const visitorId = clean(input.visitorId, 200, 'visitorId')
    if (!visitorId && !contact) throw new ErasureRequestError('A visitorId or a contact is required', 400)

    const days = (await this.policy(input.tenantId)).erasureResponseDays ?? DEFAULT_ERASURE_RESPONSE_DAYS
    const now = new Date()
    const at = now.toISOString()
    const request: ErasureRequest = {
      id: sortableEntityId('erq'),
      tenantId: input.tenantId,
      collection: 'erasure_request',
      ref: visitorId ? this.visitorRef(visitorId) : null,
      status: 'received',
      dueAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
      createdAt: at,
      updatedAt: at,
      data: {
        channel: input.channel,
        contact,
        message,
        visitorId,
        consentErased: false,
        history: [{ at, status: 'received', actorId: input.actorId ?? null, note: null }],
      },
    }
    await this.storage.putEntity(request)
    await this.audit.log({
      tenantId: input.tenantId,
      ...(input.actorId ? { userId: input.actorId } : {}),
      action: 'erasure_request:created',
      resourceType: 'erasure_request',
      resourceId: request.id,
      newData: { channel: input.channel, dueAt: request.dueAt, hasVisitorId: !!visitorId, hasContact: !!contact },
    })
    return request
  }

  async get(tenantId: string, id: string): Promise<ErasureRequest | null> {
    return await this.storage.getEntity(tenantId, 'erasure_request', id) as unknown as ErasureRequest | null
  }

  async transition(tenantId: string, id: string, t: ErasureTransition): Promise<ErasureRequest> {
    const request = await this.get(tenantId, id)
    if (!request) throw new ErasureRequestError('Erasure request not found', 404)
    if (!ERASURE_STATUSES.includes(t.status)) throw new ErasureRequestError('Invalid status', 400)
    const from = request.status as ErasureRequestStatus
    if (!NEXT[from].includes(t.status)) throw new ErasureRequestError(`Cannot move a ${from} request to ${t.status}`, 409)
    const note = clean(t.note, MAX_MESSAGE_LENGTH, 'note')
    if (t.status === 'rejected' && !note) throw new ErasureRequestError('A note with the reason is required to reject a request', 400)

    let consentErased = request.data.consentErased
    if (t.status === 'completed' && t.eraseConsent) {
      if (!request.data.visitorId) throw new ErasureRequestError('This request has no visitor ID to erase', 400)
      await this.eraseConsent(tenantId, request.data.visitorId)
      consentErased = true
    }

    const at = new Date().toISOString()
    const closed = t.status === 'completed' || t.status === 'rejected'
    const next: ErasureRequest = {
      ...request,
      status: t.status,
      updatedAt: at,
      data: {
        ...request.data,
        // Not needed once the request is closed; the hashed ref still links it to receipts.
        visitorId: closed ? null : request.data.visitorId,
        consentErased,
        history: [...request.data.history, { at, status: t.status, actorId: t.actorId ?? null, note }],
      },
    }
    await this.storage.putEntity(next)
    await this.audit.log({
      tenantId,
      ...(t.actorId ? { userId: t.actorId } : {}),
      action: 'erasure_request:status_changed',
      resourceType: 'erasure_request',
      resourceId: id,
      oldData: { status: from },
      newData: { status: t.status, consentErased },
    })
    return next
  }

  async list(filter: Omit<EntityFilter, 'collection'>, options: EntityListOptions = {}): Promise<ErasureRequest[]> {
    return await this.storage.listEntities({ ...filter, collection: 'erasure_request' }, options) as unknown as ErasureRequest[]
  }

  count(filter: Omit<EntityFilter, 'collection'>): Promise<number> {
    return this.storage.countEntities({ ...filter, collection: 'erasure_request' })
  }

  /** Open requests past their due date. */
  async overdue(tenantId: string, now = new Date()): Promise<ErasureRequest[]> {
    const out: ErasureRequest[] = []
    for (const status of OPEN_ERASURE_STATUSES) {
      out.push(...await this.list({ tenantId, status, dueBefore: now.toISOString() }, { order: 'asc', limit: 1000 }))
    }
    return out.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
  }
}

function clean(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new ErasureRequestError(`${field} must be a string`, 400)
  const s = v.trim()
  if (s.length > max) throw new ErasureRequestError(`${field} is longer than ${max} characters`, 400)
  return s || null
}
