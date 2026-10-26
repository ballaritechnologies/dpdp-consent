import { isSafeLocale } from '../utils/path-segment'

const LABEL_KEYS = new Set([
  'draftBadge', 'dataFiduciary', 'purposes', 'purposeAlwaysOn', 'grievance', 'grievanceLink',
  'withdraw', 'noticeVersion', 'reopenButton', 'reopenAriaLabel',
])

const MAX_TEXT = 500

function textProblem(field: string, value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) return required ? `dpdpa.${field} is required` : null
  if (typeof value !== 'string') return `dpdpa.${field} must be a string`
  if (required && value.trim() === '') return `dpdpa.${field} is required`
  if (value.length > MAX_TEXT) return `dpdpa.${field} must be at most ${MAX_TEXT} characters`
  return null
}

/** First problem in a profile's `dpdpa` block, or null. The widget renders all of it to visitors,
 * so links must be https and emails must look like emails. */
export function findDpdpaProblem(dpdpa: unknown): string | null {
  if (dpdpa === undefined || dpdpa === null) return null
  if (typeof dpdpa !== 'object' || Array.isArray(dpdpa)) return 'dpdpa must be an object'
  const d = dpdpa as Record<string, unknown>

  for (const [field, required] of [['dataFiduciary', true], ['grievanceEmail', true], ['purposeDescription', false], ['grievanceOfficer', false], ['noticeVersion', false], ['grievanceUrl', false]] as const) {
    const problem = textProblem(field, d[field], required)
    if (problem) return problem
  }
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(d['grievanceEmail']).trim())) {
    return 'dpdpa.grievanceEmail must be an email address'
  }
  if (d['grievanceUrl'] !== undefined) {
    let protocol = ''
    try { protocol = new URL(String(d['grievanceUrl'])).protocol } catch { /* checked below */ }
    if (protocol !== 'https:') return 'dpdpa.grievanceUrl must be an https:// URL'
  }
  if (d['noticeStatus'] !== undefined && d['noticeStatus'] !== 'draft' && d['noticeStatus'] !== 'reviewed') {
    return 'dpdpa.noticeStatus must be "draft" or "reviewed"'
  }
  if (d['reopenControl'] !== undefined && typeof d['reopenControl'] !== 'boolean') {
    return 'dpdpa.reopenControl must be a boolean'
  }
  if (d['labels'] !== undefined) {
    if (!d['labels'] || typeof d['labels'] !== 'object' || Array.isArray(d['labels'])) return 'dpdpa.labels must be an object keyed by locale'
    for (const [locale, set] of Object.entries(d['labels'] as Record<string, unknown>)) {
      if (!isSafeLocale(locale)) return `dpdpa.labels has an invalid locale key "${locale}"`
      if (!set || typeof set !== 'object' || Array.isArray(set)) return `dpdpa.labels.${locale} must be an object`
      for (const [key, value] of Object.entries(set as Record<string, unknown>)) {
        if (!LABEL_KEYS.has(key)) return `dpdpa.labels.${locale}.${key} is not a known label`
        const problem = textProblem(`labels.${locale}.${key}`, value, false)
        if (problem) return problem
      }
    }
  }
  return null
}
