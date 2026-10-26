import type { ScanReport, TrackerFinding } from '../types.js'
import type { DpdpCheckId, DpdpCheckResult, DpdpGap, DpdpPageProbe, DpdpReport, DpdpSeverity } from './types.js'

export const DPDP_DISCLAIMER =
  'This report lists gaps found by automated checks. It is not legal advice, and it does not say ' +
  'whether a site meets the DPDP Act or any other law. A check that found no gap may simply have ' +
  'missed something. Have a lawyer review your notice and consent setup.'

export const DPDP_CHECK_TITLES: Record<DpdpCheckId, string> = {
  'consent-notice': 'A consent notice is shown',
  'trackers-before-consent': 'No tracking before the visitor chooses',
  'trackers-after-reject': 'No tracking after "Reject all"',
  'pre-ticked-or-bundled': 'Consent is not pre-ticked or bundled',
  'withdrawal-control': 'Consent can be withdrawn later',
  'grievance-contact': 'A grievance contact is given',
  'indian-language': 'The notice is offered in an Indian language',
  'essential-blocked': 'The site works without optional consent',
}

const OPTIONAL_CATEGORIES = new Set<TrackerFinding['category']>(['analytics', 'marketing', 'fingerprinting'])
const OPTIONAL_PURPOSE_WORDS = /analytic|statistic|marketing|advertis|\bads?\b|targeting|personali[sz]|social|tracking|performance/i
const SEVERITY_ORDER: Record<DpdpSeverity, number> = { high: 0, medium: 1, low: 2 }

function describe(f: TrackerFinding): string {
  return `${f.vendor ?? f.id} (${f.kind}${f.category ? `, ${f.category}` : ''})`
}

/** Unique findings across pages that match `filter`, keyed by kind+id, with the pages they were on. */
function collect(scan: ScanReport, filter: (f: TrackerFinding) => boolean): { items: string[]; pages: string[] } {
  const items = new Map<string, string>()
  const pages = new Set<string>()
  for (const page of scan.pages) {
    for (const f of page.findings) {
      if (!filter(f)) continue
      items.set(`${f.kind}:${f.id}`, describe(f))
      pages.add(page.url)
    }
  }
  return { items: [...items.values()].sort(), pages: [...pages] }
}

/**
 * Turns a scan (what fired in each consent state) plus the DPDP page probes into a gap report.
 * Pure: no browser, no I/O — so every rule is unit-testable on plain data.
 */
export function evaluateDpdp(scan: ScanReport, probes: DpdpPageProbe[], checkedAt = new Date().toISOString()): DpdpReport {
  const gaps: DpdpGap[] = []
  const checks = new Map<DpdpCheckId, DpdpCheckResult>()
  const mark = (check: DpdpCheckId, result: DpdpCheckResult['result'], note?: string): void => {
    const existing = checks.get(check)
    if (existing?.result === 'gaps-found') return
    checks.set(check, { check, title: DPDP_CHECK_TITLES[check], result, ...(note ? { note } : {}) })
  }
  const gap = (g: DpdpGap): void => {
    gaps.push(g)
    mark(g.check, 'gaps-found')
  }

  const okProbes = probes.filter(p => !p.error)
  const bannerPages = okProbes.filter(p => p.bannerFound)
  const anyCmp = scan.pages.some(p => p.cmpDetected) || bannerPages.length > 0

  // 1. Notice shown at all
  if (!anyCmp) {
    gap({
      check: 'consent-notice', severity: 'high', title: 'No consent notice found',
      detail: 'No cookie or consent banner was detected on the checked pages, so visitors are never asked for consent.',
      fix: 'Show a consent notice before any optional data processing starts, listing each purpose separately with its own choice.',
      pages: scan.pagesScanned, evidence: [],
    })
  } else {
    mark('consent-notice', 'no-gaps-found')
  }

  // 2. Tracking before a choice
  const before = collect(scan, f => f.seenInStates.includes('no-consent') && OPTIONAL_CATEGORIES.has(f.category))
  const fingerprintBefore = scan.pages.flatMap(p => p.fingerprinting.filter(f => f.seenInStates.includes('no-consent')).map(f => `${f.technique} fingerprinting (${f.scriptUrl ?? 'inline script'})`))
  if (before.items.length > 0 || fingerprintBefore.length > 0) {
    gap({
      check: 'trackers-before-consent', severity: 'high', title: 'Tracking starts before the visitor chooses',
      detail: `${before.items.length + fingerprintBefore.length} analytics, advertising or fingerprinting item(s) ran before the visitor made any choice.`,
      fix: 'Load these tags only after the visitor consents to their purpose: block them by default and release them from your consent tool (for example with Google Consent Mode or script blocking).',
      pages: before.pages, evidence: [...before.items, ...fingerprintBefore],
    })
  } else {
    mark('trackers-before-consent', 'no-gaps-found')
  }
  const unknownBefore = collect(scan, f => f.seenInStates.includes('no-consent') && f.confidence === 'unclassified' && (f.kind === 'request' || f.kind === 'script'))
  if (unknownBefore.items.length > 0) {
    gap({
      check: 'trackers-before-consent', severity: 'low', title: 'Unidentified third parties load before the visitor chooses',
      detail: `${unknownBefore.items.length} third-party domain(s) the checker could not identify were contacted before any choice. They may be harmless (fonts, CDNs) or may collect data.`,
      fix: 'Review each domain. If it collects personal data for an optional purpose, load it only after consent.',
      pages: unknownBefore.pages, evidence: unknownBefore.items,
    })
  }

  // 3. Tracking after "Reject all" — only where a reject option was actually found and clicked;
  // elsewhere the scan's reject-all state is just the untouched page again.
  const rejectable = new Set(okProbes.filter(p => p.hasRejectOption && !p.notes.includes('could not click "Reject all"')).map(p => p.url))
  const cmpPages = scan.pages.filter(p => p.cmpDetected && rejectable.has(p.url))
  if (cmpPages.length === 0) {
    mark('trackers-after-reject', 'not-checked', bannerPages.length === 0 ? 'no consent banner found' : 'no "Reject all" option to test')
  } else {
    const after = collect({ ...scan, pages: cmpPages }, f => f.seenInStates.includes('reject-all') && OPTIONAL_CATEGORIES.has(f.category))
    if (after.items.length > 0) {
      gap({
        check: 'trackers-after-reject', severity: 'high', title: 'Tracking continues after "Reject all"',
        detail: `${after.items.length} analytics, advertising or fingerprinting item(s) still ran after the visitor rejected all optional purposes.`,
        fix: 'Make "Reject all" actually stop these tags, and remove any cookies they already set.',
        pages: after.pages, evidence: after.items,
      })
    } else {
      mark('trackers-after-reject', 'no-gaps-found')
    }
  }

  // 4. Pre-ticked or bundled
  if (bannerPages.length === 0) {
    mark('pre-ticked-or-bundled', 'not-checked', 'no consent banner found')
  } else {
    mark('pre-ticked-or-bundled', 'no-gaps-found')
    const preTicked = bannerPages.flatMap(p => (p.categories ?? []).filter(c => !c.locked && c.initiallyOn).map(c => ({ page: p.url, label: c.label })))
    if (preTicked.length > 0) {
      gap({
        check: 'pre-ticked-or-bundled', severity: 'high', title: 'Optional purposes are switched on before the visitor chooses',
        detail: 'Some optional purposes in the preferences panel start switched on.',
        fix: 'Start every optional purpose switched off, so consent is only given by an action of the visitor.',
        pages: [...new Set(preTicked.map(p => p.page))], evidence: [...new Set(preTicked.map(p => p.label))],
      })
    }
    const lockedOptional = bannerPages.flatMap(p => (p.categories ?? []).filter(c => c.locked && OPTIONAL_PURPOSE_WORDS.test(c.label)).map(c => ({ page: p.url, label: c.label })))
    if (lockedOptional.length > 0) {
      gap({
        check: 'pre-ticked-or-bundled', severity: 'high', title: 'Optional purposes are bundled with essential ones',
        detail: 'Some purposes that look optional (analytics, advertising, personalisation) cannot be switched off.',
        fix: 'Give each optional purpose its own choice. Keep "always on" only for what the service cannot work without.',
        pages: [...new Set(lockedOptional.map(p => p.page))], evidence: [...new Set(lockedOptional.map(p => p.label))],
      })
    }
    const allOrNothing = bannerPages.filter(p => p.hasAcceptOption && !p.hasRejectOption && !p.hasManageOption)
    if (allOrNothing.length > 0) {
      gap({
        check: 'pre-ticked-or-bundled', severity: 'high', title: 'The notice offers only "Accept"',
        detail: 'The notice has an accept option but no way to refuse or to choose purposes one by one.',
        fix: 'Add a "Reject all" option as prominent as "Accept all", and a way to choose each purpose separately.',
        pages: allOrNothing.map(p => p.url), evidence: [...new Set(allOrNothing.flatMap(p => p.bannerButtons))],
      })
    }
    const noOneClickReject = bannerPages.filter(p => p.hasAcceptOption && !p.hasRejectOption && p.hasManageOption)
    if (noOneClickReject.length > 0) {
      gap({
        check: 'pre-ticked-or-bundled', severity: 'medium', title: 'Refusing takes more steps than accepting',
        detail: 'Accepting takes one click on the notice, but refusing needs the preferences panel.',
        fix: 'Add a "Reject all" button next to "Accept all" on the first screen, with the same prominence.',
        pages: noOneClickReject.map(p => p.url), evidence: [...new Set(noOneClickReject.flatMap(p => p.bannerButtons))],
      })
    }
  }

  // 5. Withdrawal control
  const acceptChecked = bannerPages.filter(p => p.hasAcceptOption && !p.notes.includes('could not click "Accept all"'))
  if (acceptChecked.length === 0) {
    mark('withdrawal-control', 'not-checked', bannerPages.length === 0 ? 'no consent banner found' : 'could not accept, so withdrawal was not checked')
  } else {
    const missing = acceptChecked.filter(p => p.withdrawalControl === null)
    if (missing.length > 0) {
      gap({
        check: 'withdrawal-control', severity: 'medium', title: 'No visible way to withdraw consent later',
        detail: 'After accepting and reloading, no "Privacy choices", "Cookie settings" or similar control was found on the page.',
        fix: 'Keep a persistent, clearly labelled control (for example a "Privacy choices" button or footer link) that reopens the choices, so withdrawing is as easy as consenting.',
        pages: missing.map(p => p.url), evidence: [],
      })
    } else {
      mark('withdrawal-control', 'no-gaps-found')
    }
  }

  // 6. Grievance contact
  if (okProbes.length === 0) {
    mark('grievance-contact', 'not-checked', 'no page could be probed')
  } else if (!okProbes.some(p => p.grievanceOnBanner || p.grievanceOnPage)) {
    gap({
      check: 'grievance-contact', severity: 'medium', title: 'No grievance contact found',
      detail: 'No grievance officer or grievance contact was found in the notice or on the checked pages.',
      fix: 'Name a grievance contact (for example "Grievance Officer: name, email") in the notice and on your privacy page.',
      pages: okProbes.map(p => p.url), evidence: [],
    })
  } else if (bannerPages.length > 0 && !bannerPages.some(p => p.grievanceOnBanner)) {
    gap({
      check: 'grievance-contact', severity: 'low', title: 'The grievance contact is not in the notice itself',
      detail: 'A grievance contact appears on the site, but not in the consent notice or its preferences panel.',
      fix: 'Show the grievance contact (or a link to it) in the consent notice, where visitors make their choice.',
      pages: bannerPages.map(p => p.url), evidence: [],
    })
  } else {
    mark('grievance-contact', 'no-gaps-found')
  }

  // 7. Indian language
  if (okProbes.length === 0) {
    mark('indian-language', 'not-checked', 'no page could be probed')
  } else if (!okProbes.some(p => p.indianLanguageEvidence.length > 0)) {
    gap({
      check: 'indian-language', severity: 'medium', title: 'No Indian-language option found',
      detail: 'The notice and pages offered no Indian-language text or language option.',
      fix: 'Offer the notice in English and in Indian languages your visitors use (for example Hindi, Kannada, Telugu, Tamil), with a visible language switcher.',
      pages: okProbes.map(p => p.url), evidence: [],
    })
  } else {
    mark('indian-language', 'no-gaps-found')
  }

  // 8. Essential functions blocked
  const walled = okProbes.filter(p => p.wallEvidence.length > 0)
  if (okProbes.length === 0) {
    mark('essential-blocked', 'not-checked', 'no page could be probed')
  } else if (walled.length > 0) {
    gap({
      check: 'essential-blocked', severity: 'high', title: 'The site may be unusable without optional consent',
      detail: 'Signs that the site cannot be used unless the visitor consents to optional purposes.',
      fix: 'Let visitors use the service after refusing optional purposes. Do not make consent to optional purposes a condition of using the site.',
      pages: walled.map(p => p.url), evidence: [...new Set(walled.flatMap(p => p.wallEvidence))],
    })
  } else {
    mark('essential-blocked', 'no-gaps-found')
  }

  gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const order = Object.keys(DPDP_CHECK_TITLES) as DpdpCheckId[]
  return {
    kind: 'dpdp-gap-report',
    version: 1,
    startUrl: scan.startUrl,
    checkedAt,
    scanId: scan.id,
    pagesChecked: probes.map(p => p.url),
    gapsFound: gaps.length,
    gaps,
    checks: order.map(id => checks.get(id) ?? { check: id, title: DPDP_CHECK_TITLES[id], result: 'not-checked' }),
    partial: scan.interrupted,
    disclaimer: DPDP_DISCLAIMER,
  }
}
