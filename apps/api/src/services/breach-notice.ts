import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BreachIncident, BreachNoticeKind } from '@consenti/types'
import { isSafeLocale } from '../utils/path-segment'

export const BREACH_DRAFT_LABEL = 'DRAFT - REQUIRES LEGAL REVIEW'
export const BREACH_NOTICE_KINDS: readonly BreachNoticeKind[] = ['board-intimation', 'board-report', 'user-notice']
const EMPTY = '[to be completed]'

/** `2026-10-27T08:35:00.000Z` → `2026-10-27 08:35 UTC`; `null` → the empty marker. */
export function formatNoticeDate(iso: string | null): string {
  if (!iso) return EMPTY
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? EMPTY : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Placeholder values for an incident: plain text, empty fields marked for completion. */
export function noticeValues(incident: BreachIncident, now = new Date()): Record<string, string> {
  const d = incident.data
  const text = (v: string) => (v.trim() ? v.trim() : EMPTY)
  const list = (v: string[]) => (v.length ? v.join(', ') : EMPTY)
  return {
    organisation: text(d.organisation),
    contactName: text(d.contactName),
    contactEmail: text(d.contactEmail),
    incidentId: incident.id,
    title: text(d.title),
    description: text(d.description),
    cause: text(d.cause),
    discoveredAt: formatNoticeDate(d.discoveredAt),
    occurredAt: formatNoticeDate(d.occurredAt),
    containedAt: formatNoticeDate(d.containedAt),
    reportDueAt: formatNoticeDate(incident.dueAt),
    severity: d.severity,
    dataCategories: list(d.dataCategories),
    affectedCount: d.affectedCount === null ? EMPTY : String(d.affectedCount),
    affectedRegions: list(d.affectedRegions),
    systems: text(d.systems),
    likelyImpact: text(d.likelyImpact),
    containment: text(d.containment),
    userSteps: text(d.userSteps),
    usersNotifiedAt: formatNoticeDate(d.usersNotifiedAt),
    today: now.toISOString().slice(0, 10),
  }
}

/** Fills `{{name}}` placeholders; unknown names become the empty marker. Always starts with the
 * draft label, whatever the template says. */
export function renderNotice(template: string, values: Record<string, string>): string {
  const body = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => values[name] ?? EMPTY)
  const firstLine = body.split('\n').find(l => l.trim() !== '')?.trim()
  return firstLine === BREACH_DRAFT_LABEL ? body : `${BREACH_DRAFT_LABEL}\n\n${body}`
}

/**
 * Reads `<kind>.<locale>.md`, then `<kind>.en.md`, from each folder in order (the site's own
 * folder first, then the built-in one). Returns the text and which file it came from.
 */
export async function loadNoticeTemplate(
  dirs: readonly string[], kind: BreachNoticeKind, locale: string,
): Promise<{ text: string; file: string }> {
  if (!BREACH_NOTICE_KINDS.includes(kind)) throw new Error(`Unknown notice kind: ${kind}`)
  const locales = isSafeLocale(locale) && locale !== 'en' ? [locale, 'en'] : ['en']
  for (const loc of locales) {
    for (const dir of dirs) {
      const file = join(dir, `${kind}.${loc}.md`)
      try {
        return { text: await readFile(file, 'utf8'), file: `${kind}.${loc}.md` }
      } catch { /* try the next one */ }
    }
  }
  throw new Error(`No template found for ${kind}`)
}
