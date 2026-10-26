/**
 * DPDP consent checker (Phase 3): every rule in `evaluateDpdp()` on plain data, the report
 * wording, and end-to-end runs against two fixture sites (one with deliberate gaps, one without).
 *
 * The fixture runs need Playwright's Chromium (CI installs it). Set CHROMIUM_PATH to use another
 * local Chromium binary.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateDpdp, DPDP_DISCLAIMER } from '../dpdp/checks.js'
import { renderDpdpHtml } from '../dpdp/html.js'
import { runDpdpCheck, writeDpdpReport } from '../dpdp/run.js'
import type { DpdpPageProbe } from '../dpdp/types.js'
import { DEFAULT_SCAN_OPTIONS, type PageResult, type ScanReport, type TrackerFinding } from '../types.js'

const URL_A = 'https://shop.example/'

function finding(id: string, category: TrackerFinding['category'], states: TrackerFinding['seenInStates'], extra: Partial<TrackerFinding> = {}): TrackerFinding {
  return { id, kind: 'cookie', vendor: id === '_ga' ? 'Google Analytics' : null, category, confidence: 'exact', seenInStates: states, ...extra }
}

function page(over: Partial<PageResult> = {}): PageResult {
  return {
    url: URL_A, cmpDetected: true, bannerDetectionMethod: 'known-selector', bannerOptions: [], preferenceCategories: [],
    categoryStates: [], inferredBannerActions: [], signalsByState: {}, findings: [], cloaking: [], fingerprinting: [],
    tagManagers: [], screenshotsByState: {}, blockingSuspicion: { suspected: false, evidence: [], statusCodes: [] } as unknown as PageResult['blockingSuspicion'],
    ...over,
  }
}

function scan(pages: PageResult[], over: Partial<ScanReport> = {}): ScanReport {
  return {
    id: 'scan1', startUrl: URL_A, scannedAt: '2026-10-27T00:00:00Z', depth: 1, pageLimit: 10,
    pagesScanned: pages.map(p => p.url), pagesSkippedRobots: [], pagesUnscanned: [], interrupted: false, pages,
    summary: { totalUniqueTrackers: 0, firingBeforeConsent: 0, unclassifiedCount: 0, manualReview: [], pagesWithBlockingSuspicion: 0 },
    ...over,
  }
}

function probe(over: Partial<DpdpPageProbe> = {}): DpdpPageProbe {
  return {
    url: URL_A, bannerFound: true, bannerText: 'Grievance Officer: a@b.example', bannerButtons: ['Accept all', 'Reject all', 'Choose purposes'],
    hasAcceptOption: true, hasRejectOption: true, hasManageOption: true,
    categories: [{ label: 'Essential', locked: true, initiallyOn: true }, { label: 'Analytics', locked: false, initiallyOn: false }],
    grievanceOnBanner: true, grievanceOnPage: true, indianLanguageEvidence: ['language option "हिन्दी"'],
    withdrawalControl: '#consenti-dpdp-reopen', wallEvidence: [], notes: [],
    ...over,
  }
}

const gapChecks = (r: ReturnType<typeof evaluateDpdp>) => r.gaps.map(g => `${g.check}:${g.severity}`)
const resultOf = (r: ReturnType<typeof evaluateDpdp>, id: string) => r.checks.find(c => c.check === id)?.result

describe('evaluateDpdp — rules on plain data', () => {
  test('a well-behaved site has no gaps, and every check ran', () => {
    const r = evaluateDpdp(scan([page({ findings: [finding('_ga', 'analytics', ['accept-all'])] })]), [probe()])
    assert.deepEqual(r.gaps, [])
    assert.equal(r.gapsFound, 0)
    assert.ok(r.checks.every(c => c.result === 'no-gaps-found'), JSON.stringify(r.checks))
  })

  test('no banner at all', () => {
    const r = evaluateDpdp(scan([page({ cmpDetected: false })]), [probe({ bannerFound: false, bannerText: '', grievanceOnBanner: false })])
    assert.ok(gapChecks(r).includes('consent-notice:high'))
    assert.equal(resultOf(r, 'pre-ticked-or-bundled'), 'not-checked')
    assert.equal(resultOf(r, 'withdrawal-control'), 'not-checked')
  })

  test('analytics, advertising and fingerprinting before a choice; unclassified third parties as low', () => {
    const r = evaluateDpdp(scan([page({
      findings: [
        finding('_ga', 'analytics', ['no-consent', 'reject-all', 'accept-all']),
        finding('_fbp', 'marketing', ['no-consent']),
        finding('session', 'necessary', ['no-consent']),
        finding('cdn.unknown.example', null, ['no-consent'], { kind: 'request', confidence: 'unclassified' }),
      ],
      fingerprinting: [{ technique: 'canvas', scriptUrl: 'https://fp.example/x.js', seenInStates: ['no-consent'] }],
    })]), [probe()])
    const before = r.gaps.find(g => g.check === 'trackers-before-consent' && g.severity === 'high')!
    assert.equal(before.evidence.length, 3)
    assert.ok(before.evidence.some(e => e.includes('Google Analytics')))
    assert.ok(!before.evidence.some(e => e.includes('session')), 'essential cookies are not a gap')
    assert.ok(gapChecks(r).includes('trackers-before-consent:low'))
    assert.ok(gapChecks(r).includes('trackers-after-reject:high'))
  })

  test('tracking "after reject" is only judged where a reject option was really clicked', () => {
    const s = scan([page({ findings: [finding('_ga', 'analytics', ['no-consent', 'reject-all', 'accept-all'])] })])
    const noReject = evaluateDpdp(s, [probe({ hasRejectOption: false, bannerButtons: ['Accept all', 'Cookie settings'] })])
    assert.equal(resultOf(noReject, 'trackers-after-reject'), 'not-checked')
    const clickFailed = evaluateDpdp(s, [probe({ notes: ['could not click "Reject all"'] })])
    assert.equal(resultOf(clickFailed, 'trackers-after-reject'), 'not-checked')
  })

  test('pre-ticked, bundled, accept-only and harder-to-refuse', () => {
    const preTicked = evaluateDpdp(scan([page()]), [probe({ categories: [
      { label: 'Essential', locked: true, initiallyOn: true },
      { label: 'Analytics', locked: false, initiallyOn: true },
      { label: 'Advertising cookies', locked: true, initiallyOn: true },
    ] })])
    const titles = preTicked.gaps.filter(g => g.check === 'pre-ticked-or-bundled').map(g => g.title)
    assert.ok(titles.some(t => /switched on/.test(t)))
    assert.ok(titles.some(t => /bundled/.test(t)))
    assert.deepEqual(preTicked.gaps.find(g => /bundled/.test(g.title))!.evidence, ['Advertising cookies'])

    const acceptOnly = evaluateDpdp(scan([page()]), [probe({ hasRejectOption: false, hasManageOption: false, bannerButtons: ['OK, I agree'] })])
    assert.ok(acceptOnly.gaps.some(g => g.title === 'The notice offers only "Accept"' && g.severity === 'high'))

    const twoStep = evaluateDpdp(scan([page()]), [probe({ hasRejectOption: false })])
    assert.ok(twoStep.gaps.some(g => g.title === 'Refusing takes more steps than accepting' && g.severity === 'medium'))
  })

  test('withdrawal control', () => {
    assert.ok(gapChecks(evaluateDpdp(scan([page()]), [probe({ withdrawalControl: null })])).includes('withdrawal-control:medium'))
    const couldNotAccept = evaluateDpdp(scan([page()]), [probe({ withdrawalControl: null, notes: ['could not click "Accept all"'] })])
    assert.equal(resultOf(couldNotAccept, 'withdrawal-control'), 'not-checked')
  })

  test('grievance contact: missing everywhere (medium) vs only off the notice (low)', () => {
    const none = evaluateDpdp(scan([page()]), [probe({ grievanceOnBanner: false, grievanceOnPage: false })])
    assert.ok(gapChecks(none).includes('grievance-contact:medium'))
    const pageOnly = evaluateDpdp(scan([page()]), [probe({ grievanceOnBanner: false, grievanceOnPage: true })])
    assert.ok(gapChecks(pageOnly).includes('grievance-contact:low'))
  })

  test('no Indian-language option', () => {
    assert.ok(gapChecks(evaluateDpdp(scan([page()]), [probe({ indianLanguageEvidence: [] })])).includes('indian-language:medium'))
  })

  test('site blocked without optional consent', () => {
    const r = evaluateDpdp(scan([page()]), [probe({ wallEvidence: ['the page stays locked (no scrolling) after "Reject all"'] })])
    assert.ok(gapChecks(r).includes('essential-blocked:high'))
  })

  test('probes that errored are not counted as evidence either way', () => {
    const r = evaluateDpdp(scan([page()]), [probe({ error: 'navigation timeout', indianLanguageEvidence: [] })])
    assert.equal(resultOf(r, 'indian-language'), 'not-checked')
    assert.equal(resultOf(r, 'grievance-contact'), 'not-checked')
  })

  test('gaps are ordered high → medium → low; an interrupted scan is marked partial', () => {
    const r = evaluateDpdp(
      scan([page({ findings: [finding('cdn.x.example', null, ['no-consent'], { kind: 'request', confidence: 'unclassified' }), finding('_ga', 'analytics', ['no-consent'])] })], { interrupted: true }),
      [probe({ withdrawalControl: null })],
    )
    const order = r.gaps.map(g => g.severity)
    assert.deepEqual(order, [...order].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)))
    assert.equal(r.partial, true)
  })
})

describe('report wording', () => {
  const FORBIDDEN = /\b(non-?compliant|compliant|compliance|certified|guaranteed?|legally valid)\b/i

  test('JSON and HTML say "gaps found", carry the disclaimer, and make no compliance claims', () => {
    const r = evaluateDpdp(scan([page({ findings: [finding('_ga', 'analytics', ['no-consent'])] })]), [probe({ withdrawalControl: null })])
    const html = renderDpdpHtml(r)
    assert.match(html, /gaps found/i)
    assert.ok(html.includes(DPDP_DISCLAIMER))
    assert.match(DPDP_DISCLAIMER, /not legal advice/)
    assert.doesNotMatch(JSON.stringify(r), FORBIDDEN)
    assert.doesNotMatch(html, FORBIDDEN)
  })

  test('HTML escapes everything taken from the site', () => {
    const r = evaluateDpdp(scan([page({ url: 'https://x.example/"><script>alert(1)</script>' })], { startUrl: 'https://x.example/<b>' }), [probe({ url: 'https://x.example/"><script>alert(1)</script>', withdrawalControl: null })])
    const html = renderDpdpHtml(r)
    assert.doesNotMatch(html, /<script>alert/)
    assert.doesNotMatch(html, /<b>/)
  })
})

// ─── End to end against fixture sites ─────────────────────────────────────────

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'dpdp')

describe('runDpdpCheck on fixture sites', () => {
  let server: Server
  let base = ''
  let outputDir = ''

  before(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'dpdp-checker-'))
    server = createServer(async (req, res) => {
      const site = (req.url ?? '/').split('/')[1] ?? ''
      if (!['gappy', 'good'].includes(site)) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(await readFile(join(FIXTURES, site, 'index.html')))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(outputDir, { recursive: true, force: true })
  })

  const options = () => ({
    ...DEFAULT_SCAN_OPTIONS,
    depth: 0,
    pageLimit: 1,
    outputDir,
    skipRobotsTxt: true,
    crawlDelaySeconds: -10, // floors to the minimum wait: keeps the fixture runs fast
    settleTimeoutMs: 400,
    dpdpProbePages: 1,
  })

  test('the gappy site: every deliberate gap is found', async () => {
    const { report, probes } = await runDpdpCheck(`${base}/gappy/`, options())
    assert.equal(probes[0]?.error, undefined, String(probes[0]?.error))
    const found = new Set(report.gaps.map(g => g.check))
    for (const check of ['trackers-before-consent', 'pre-ticked-or-bundled', 'withdrawal-control', 'grievance-contact', 'indian-language', 'essential-blocked']) {
      assert.ok(found.has(check as never), `expected a ${check} gap; got ${[...found].join(', ')}`)
    }
    const titles = report.gaps.map(g => g.title)
    assert.ok(titles.includes('Optional purposes are switched on before the visitor chooses'), titles.join(' | '))
    assert.ok(titles.includes('Optional purposes are bundled with essential ones'), titles.join(' | '))
    assert.ok(titles.includes('Refusing takes more steps than accepting'), titles.join(' | '))
    assert.equal(report.checks.find(c => c.check === 'trackers-after-reject')?.result, 'not-checked', 'there is no reject button to test')

    const { jsonPath, htmlPath } = await writeDpdpReport(report, outputDir)
    assert.ok(existsSync(jsonPath) && existsSync(htmlPath))
    assert.equal(JSON.parse(readFileSync(jsonPath, 'utf8')).kind, 'dpdp-gap-report')
    assert.match(readFileSync(htmlPath, 'utf8'), new RegExp(`<strong>${report.gapsFound}</strong>gaps found`))
  })

  test('the good site: no gaps found', async () => {
    const { report, probes } = await runDpdpCheck(`${base}/good/`, options())
    assert.equal(probes[0]?.error, undefined, String(probes[0]?.error))
    assert.deepEqual(report.gaps.map(g => `${g.check}: ${g.title}`), [])
    assert.ok(report.checks.every(c => c.result === 'no-gaps-found'), JSON.stringify(report.checks))
    assert.equal(probes[0]?.withdrawalControl, '"Privacy choices"')
  })
})
