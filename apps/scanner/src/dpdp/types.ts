/** What a DPDP probe saw on one page (see `probe.ts`). Plain data, so checks stay pure. */
export interface DpdpPageProbe {
  url: string
  bannerFound: boolean
  /** Visible text of the consent banner as first shown; '' when none. */
  bannerText: string
  /** Labels of the banner's buttons/links as first shown. */
  bannerButtons: string[]
  hasAcceptOption: boolean
  hasRejectOption: boolean
  hasManageOption: boolean
  /** Toggles in the preferences panel as first opened; `null` when no panel could be opened. */
  categories: Array<{ label: string; locked: boolean; initiallyOn: boolean }> | null
  grievanceOnBanner: boolean
  grievanceOnPage: boolean
  /** Evidence of an Indian-language option or text (each item says what was seen). */
  indianLanguageEvidence: string[]
  /** What was seen after accepting all and reloading: a selector or label, or null. */
  withdrawalControl: string | null
  /** Evidence that the page stays blocked without consent to optional purposes. */
  wallEvidence: string[]
  /** Probe steps that could not run (e.g. no accept button to click). */
  notes: string[]
  error?: string
}

export type DpdpSeverity = 'high' | 'medium' | 'low'

export type DpdpCheckId =
  | 'consent-notice'
  | 'trackers-before-consent'
  | 'trackers-after-reject'
  | 'pre-ticked-or-bundled'
  | 'withdrawal-control'
  | 'grievance-contact'
  | 'indian-language'
  | 'essential-blocked'

export interface DpdpGap {
  check: DpdpCheckId
  severity: DpdpSeverity
  title: string
  /** What the checker saw, in plain English. */
  detail: string
  /** A plain-English suggestion for closing the gap. */
  fix: string
  pages: string[]
  /** Specific items (tracker names, toggle labels, …) behind the gap. */
  evidence: string[]
}

export interface DpdpCheckResult {
  check: DpdpCheckId
  title: string
  result: 'gaps-found' | 'no-gaps-found' | 'not-checked'
  note?: string
}

export interface DpdpReport {
  kind: 'dpdp-gap-report'
  version: 1
  startUrl: string
  checkedAt: string
  scanId: string
  pagesChecked: string[]
  gapsFound: number
  gaps: DpdpGap[]
  checks: DpdpCheckResult[]
  /** True when the underlying scan was stopped early — the report covers only part of the site. */
  partial: boolean
  disclaimer: string
}
