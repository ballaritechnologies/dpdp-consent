import type {
  StorageAdapter, BreachIncident, BreachIncidentFields, BreachStatus, BreachSeverity, BreachMilestone,
  BreachNoticeKind, BreachHistoryEntry, BreachDeadlineEvent, EntityListOptions,
} from '@consenti/types'
import type { EventEmitter } from 'node:events'
import type { AuditRepo } from '../repositories/audit.repo'
import { sortableEntityId } from '../storage/entity-sql'
import { loadNoticeTemplate, noticeValues, renderNotice, BREACH_NOTICE_KINDS } from './breach-notice'

/** Hours from becoming aware of a breach to the detailed report to the Board (DPDP Rules 2025,
 * rule 7(2)(b); GDPR Art. 33 uses the same 72 hours). TODO(legal): Q-B1. */
export const BREACH_REPORT_HOURS = 72
const HOUR = 3_600_000

export const BREACH_STATUSES: readonly BreachStatus[] = ['open', 'contained', 'reported', 'closed']
export const BREACH_SEVERITIES: readonly BreachSeverity[] = ['low', 'medium', 'high', 'critical']
export const BREACH_MILESTONES: readonly BreachMilestone[] = ['boardIntimatedAt', 'boardReportSentAt', 'usersNotifiedAt']

/** Reminder points before the report deadline, most distant first. */
export const BREACH_REMINDERS: readonly { key: string; hoursLeft: number }[] = [
  { key: '48h', hoursLeft: 48 }, { key: '24h', hoursLeft: 24 }, { key: '6h', hoursLeft: 6 }, { key: 'overdue', hoursLeft: 0 },
]

export class BreachError extends Error {
  constructor(message: string, readonly status: 400 | 404) { super(message) }
}

const TEXT_LIMITS: Partial<Record<keyof BreachIncidentFields, number>> = {
  title: 200, description: 10_000, cause: 10_000, systems: 2000, likelyImpact: 5000, containment: 10_000,
  userSteps: 5000, organisation: 200, contactName: 200, contactEmail: 254,
}
const DATE_FIELDS = ['discoveredAt', 'occurredAt', 'containedAt'] as const

const EMPTY_FIELDS: Omit<BreachIncidentFields, 'title' | 'description' | 'discoveredAt' | 'severity'> = {
  occurredAt: null, containedAt: null, cause: '', dataCategories: [], affectedCount: null, affectedRegions: [],
  systems: '', likelyImpact: '', containment: '', userSteps: '', organisation: '', contactName: '', contactEmail: '',
}

/** Checks a create (`partial = false`) or update payload; returns only known, valid fields. */
export function validateBreachFields(input: unknown, partial: boolean, now = new Date()): Partial<BreachIncidentFields> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BreachError('Body must be an object', 400)
  const o = input as Record<string, unknown>
  const out: Partial<BreachIncidentFields> = {}
  const has = (k: string) => o[k] !== undefined

  for (const [k, max] of Object.entries(TEXT_LIMITS) as [keyof BreachIncidentFields, number][]) {
    if (!has(k)) continue
    const v = o[k]
    if (typeof v !== 'string') throw new BreachError(`${k} must be a string`, 400)
    if (v.length > max) throw new BreachError(`${k} must be at most ${max} characters`, 400)
    ;(out as Record<string, unknown>)[k] = v.trim()
  }
  if (out.contactEmail && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(out.contactEmail)) throw new BreachError('contactEmail must be an email address', 400)

  for (const k of DATE_FIELDS) {
    if (!has(k)) continue
    const v = o[k]
    if (v === null && k !== 'discoveredAt') { out[k] = null; continue }
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new BreachError(`${k} must be an ISO date`, 400)
    const iso = new Date(v).toISOString()
    if (Date.parse(iso) > now.getTime() + 5 * 60_000) throw new BreachError(`${k} cannot be in the future`, 400)
    ;(out as Record<string, unknown>)[k] = iso
  }

  if (has('severity')) {
    if (!BREACH_SEVERITIES.includes(o['severity'] as BreachSeverity)) throw new BreachError(`severity must be one of ${BREACH_SEVERITIES.join(', ')}`, 400)
    out.severity = o['severity'] as BreachSeverity
  }
  if (has('affectedCount')) {
    const v = o['affectedCount']
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1e10)) throw new BreachError('affectedCount must be a whole number or null', 400)
    out.affectedCount = v as number | null
  }
  for (const [k, maxItems, maxLen] of [['dataCategories', 50, 100], ['affectedRegions', 50, 50]] as const) {
    if (!has(k)) continue
    const v = o[k]
    if (!Array.isArray(v) || v.length > maxItems || v.some(x => typeof x !== 'string' || x.length > maxLen)) {
      throw new BreachError(`${k} must be a list of at most ${maxItems} short strings`, 400)
    }
    out[k] = [...new Set((v as string[]).map(x => x.trim()).filter(Boolean))]
  }

  if (!partial) {
    for (const k of ['title', 'description', 'discoveredAt', 'severity'] as const) {
      if (!out[k]) throw new BreachError(`${k} is required`, 400)
    }
  } else if (has('title') && !out.title) {
    throw new BreachError('title cannot be empty', 400)
  } else if (has('description') && !out.description) {
    throw new BreachError('description cannot be empty', 400)
  }
  return out
}

function reportDue(discoveredAt: string): string {
  return new Date(Date.parse(discoveredAt) + BREACH_REPORT_HOURS * HOUR).toISOString()
}

/**
 * Personal data breach incidents: an incident log with a 72-hour countdown to the Board report,
 * reminders as the deadline approaches, and DRAFT notices for the Board and affected people built
 * from editable templates. Ijazat never sends a notice; the site records when it did.
 * TODO(legal): Q-B4 — how long the incident log should be kept.
 */
export class BreachService {
  constructor(
    private storage: StorageAdapter,
    private audit: AuditRepo,
    private templateDirs: readonly string[],
    private eventBus?: EventEmitter,
  ) { }

  async create(tenantId: string, input: unknown, actorId: string | null): Promise<BreachIncident> {
    const fields = validateBreachFields(input, false) as Pick<BreachIncidentFields, 'title' | 'description' | 'discoveredAt' | 'severity'> & Partial<BreachIncidentFields>
    const now = new Date().toISOString()
    const incident: BreachIncident = {
      id: sortableEntityId('brc'), tenantId, collection: 'breach_incident', ref: null, status: 'open',
      dueAt: reportDue(fields.discoveredAt), createdAt: now, updatedAt: now,
      data: {
        ...EMPTY_FIELDS, ...fields,
        boardIntimatedAt: null, boardReportSentAt: null, usersNotifiedAt: null, closedAt: null,
        remindersSent: [],
        history: [{ at: now, actorId, action: 'created', detail: fields.title }],
      },
    }
    await this.storage.putEntity(incident)
    await this.log(incident, actorId, 'breach:created', null, { status: 'open', severity: fields.severity, dueAt: incident.dueAt })
    return incident
  }

  async get(tenantId: string, id: string): Promise<BreachIncident | null> {
    return await this.storage.getEntity(tenantId, 'breach_incident', id) as unknown as BreachIncident | null
  }

  async update(tenantId: string, id: string, input: unknown, actorId: string | null): Promise<BreachIncident> {
    const incident = await this.require(tenantId, id)
    const patch = validateBreachFields(input, true)
    const o = input as Record<string, unknown>
    let status = incident.status as BreachStatus
    if (o['status'] !== undefined) {
      if (!BREACH_STATUSES.includes(o['status'] as BreachStatus)) throw new BreachError(`status must be one of ${BREACH_STATUSES.join(', ')}`, 400)
      status = o['status'] as BreachStatus
    }
    const changed = Object.keys(patch).filter(k => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((incident.data as unknown as Record<string, unknown>)[k]))
    const at = new Date().toISOString()
    const history: BreachHistoryEntry[] = [...incident.data.history]
    if (changed.length) history.push({ at, actorId, action: 'updated', detail: changed.join(', ') })
    if (status !== incident.status) history.push({ at, actorId, action: 'status', detail: `${incident.status} → ${status}` })
    if (history.length === incident.data.history.length) return incident

    const discoveredChanged = patch.discoveredAt !== undefined && patch.discoveredAt !== incident.data.discoveredAt
    const next: BreachIncident = {
      ...incident,
      status,
      updatedAt: at,
      dueAt: discoveredChanged ? reportDue(patch.discoveredAt!) : incident.dueAt,
      data: {
        ...incident.data, ...patch,
        closedAt: status === 'closed' ? (incident.data.closedAt ?? at) : null,
        remindersSent: discoveredChanged ? [] : incident.data.remindersSent,
        history,
      },
    }
    await this.storage.putEntity(next)
    await this.log(next, actorId, 'breach:updated', { status: incident.status }, { status, fields: changed })
    return next
  }

  /** Records that the site sent the Board intimation, the Board report, or the user notice. */
  async markMilestone(tenantId: string, id: string, milestone: BreachMilestone, at: string | null, actorId: string | null): Promise<BreachIncident> {
    if (!BREACH_MILESTONES.includes(milestone)) throw new BreachError(`milestone must be one of ${BREACH_MILESTONES.join(', ')}`, 400)
    const incident = await this.require(tenantId, id)
    let when = new Date().toISOString()
    if (at !== null) {
      if (Number.isNaN(Date.parse(at))) throw new BreachError('at must be an ISO date', 400)
      when = new Date(at).toISOString()
    }
    const now = new Date().toISOString()
    const next: BreachIncident = {
      ...incident, updatedAt: now,
      data: { ...incident.data, [milestone]: when, history: [...incident.data.history, { at: now, actorId, action: 'milestone', detail: `${milestone} ${when}` }] },
    }
    await this.storage.putEntity(next)
    await this.log(next, actorId, 'breach:milestone', null, { milestone, at: when })
    return next
  }

  /** A DRAFT notice for review; recorded in the incident history. */
  async draftNotice(tenantId: string, id: string, kind: BreachNoticeKind, locale: string, actorId: string | null): Promise<{ kind: BreachNoticeKind; locale: string; template: string; text: string }> {
    if (!BREACH_NOTICE_KINDS.includes(kind)) throw new BreachError(`kind must be one of ${BREACH_NOTICE_KINDS.join(', ')}`, 400)
    const incident = await this.require(tenantId, id)
    const { text, file } = await loadNoticeTemplate(this.templateDirs, kind, locale)
    const rendered = renderNotice(text, noticeValues(incident))
    const now = new Date().toISOString()
    await this.storage.putEntity({
      ...incident, updatedAt: now,
      data: { ...incident.data, history: [...incident.data.history, { at: now, actorId, action: 'notice_drafted', detail: file }] },
    })
    return { kind, locale: file.split('.')[1] ?? 'en', template: file, text: rendered }
  }

  async list(tenantId: string, status: BreachStatus | undefined, options: EntityListOptions = {}): Promise<{ items: BreachIncident[]; total: number }> {
    const filter = { tenantId, collection: 'breach_incident' as const, ...(status ? { status } : {}) }
    const [items, total] = await Promise.all([this.storage.listEntities(filter, options), this.storage.countEntities(filter)])
    return { items: items as unknown as BreachIncident[], total }
  }

  /**
   * Sends at most one reminder per incident per run: the most urgent threshold reached and not
   * yet sent (earlier ones are then skipped). Stops once the Board report is recorded as sent or
   * the incident is closed. Emits `breach:deadline` for the site to forward (email, chat, …).
   */
  async runReminders(now = new Date()): Promise<BreachDeadlineEvent[]> {
    const sent: BreachDeadlineEvent[] = []
    for (const tenant of await this.storage.getTenants()) {
      for (const status of ['open', 'contained', 'reported'] as const) {
        const { items } = await this.list(tenant.id, status, { limit: 1000, order: 'asc' })
        for (const incident of items) {
          if (incident.data.boardReportSentAt || !incident.dueAt) continue
          const hoursLeft = (Date.parse(incident.dueAt) - now.getTime()) / HOUR
          const reached = BREACH_REMINDERS.filter(r => hoursLeft <= r.hoursLeft)
          const urgent = reached[reached.length - 1]
          if (!urgent || incident.data.remindersSent.includes(urgent.key)) continue
          const event: BreachDeadlineEvent = {
            tenantId: tenant.id, incidentId: incident.id, title: incident.data.title, dueAt: incident.dueAt,
            threshold: urgent.key, hoursLeft: Math.round(hoursLeft * 10) / 10,
          }
          const at = now.toISOString()
          await this.storage.putEntity({
            ...incident, updatedAt: at,
            data: {
              ...incident.data,
              remindersSent: [...new Set([...incident.data.remindersSent, ...reached.map(r => r.key)])],
              history: [...incident.data.history, { at, actorId: null, action: 'reminder', detail: urgent.key }],
            },
          })
          this.eventBus?.emit('breach:deadline', event)
          sent.push(event)
        }
      }
    }
    return sent
  }

  private async require(tenantId: string, id: string): Promise<BreachIncident> {
    const incident = await this.get(tenantId, id)
    if (!incident) throw new BreachError('Incident not found', 404)
    return incident
  }

  private async log(incident: BreachIncident, actorId: string | null, action: string, oldData: unknown, newData: unknown): Promise<void> {
    await this.audit.log({
      tenantId: incident.tenantId, ...(actorId ? { userId: actorId } : {}),
      action, resourceType: 'breach_incident', resourceId: incident.id,
      ...(oldData !== null ? { oldData } : {}), newData,
    })
  }
}
