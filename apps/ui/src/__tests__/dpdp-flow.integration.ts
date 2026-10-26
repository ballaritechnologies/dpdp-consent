/**
 * DPDP consent flow (Phase 2): the built-in notice template and its languages, the label data,
 * and — in a real browser against the built widget — the banner/modal in all four Indian
 * languages, no pre-ticked purposes, the persistent withdrawal control, the visible draft label,
 * keyboard operation and an axe accessibility scan.
 *
 * The browser half needs `npx turbo build` (the test task depends on build) and Playwright's
 * Chromium, which CI installs. Set CHROMIUM_PATH to use another local Chromium binary.
 *
 * Run: tsx --test src/__tests__/dpdp-flow.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DPDP_LABELS, DPDP_DRAFT_BADGE, resolveDpdpLabels } from '@consenti/utils'
import { DEFAULT_PROFILES, profileLocales, withLocaleOverlays } from '@consenti/utils/profiles'
import { safeGrievanceEmail, safeGrievanceUrl } from '../dpdp/notice.js'

const INDIAN_LOCALES = ['hi', 'kn', 'te', 'ta'] as const
const DPDP_LOCALES = ['en', ...INDIAN_LOCALES] as const

// ─── Template data ────────────────────────────────────────────────────────────

describe('DPDP notice template (data)', () => {
  const profile = DEFAULT_PROFILES['opt-in-dpdpa']
  const categories = profile.translations['en']!.preferenceModal.categories

  test('ships English plus Hindi, Kannada, Telugu and Tamil', () => {
    for (const locale of DPDP_LOCALES) assert.ok(profileLocales('opt-in-dpdpa').includes(locale), locale)
  })

  test('itemised: every purpose is its own category, one purpose per category', () => {
    assert.deepEqual(Object.keys(categories), ['necessary', 'functional', 'preferences', 'analytics', 'marketing'])
    for (const [id, cat] of Object.entries(categories)) {
      const purposes = new Set(cat.cookies.map(c => profile.cookies[c]?.purpose))
      assert.equal(purposes.size, 1, `category "${id}" bundles ${[...purposes].join(', ')}`)
    }
  })

  test('unbundled: only the essential category is always on, and nothing relies on legitimate interest', () => {
    const mandatory = Object.entries(categories).filter(([, c]) => c.legalBasis === 'mandatory').map(([id]) => id)
    assert.deepEqual(mandatory, ['necessary'])
    for (const cat of Object.values(categories)) assert.notEqual(cat.legalBasis, 'legitimate_interest')
  })

  test('no pre-ticked purposes', () => {
    for (const [id, cookie] of Object.entries(profile.cookies)) assert.notEqual(cookie.preGrant, true, id)
  })

  test('reject is as prominent as accept on the banner', () => {
    const buttons = profile.translations['en']!.mainBanner.buttons
    assert.equal(buttons['deny-all']?.style, buttons['consent-all']?.style)
  })

  test('every Indian language translates every heading, text, button and purpose', () => {
    const multilingual = withLocaleOverlays('opt-in-dpdpa')!
    const en = multilingual.translations['en']!
    for (const locale of INDIAN_LOCALES) {
      const tx = multilingual.translations[locale]
      assert.ok(tx, locale)
      assert.notEqual(tx.mainBanner.heading, en.mainBanner.heading, `${locale} banner heading`)
      assert.notEqual(tx.mainBanner.htmlText, en.mainBanner.htmlText, `${locale} banner text`)
      assert.notEqual(tx.preferenceModal.heading, en.preferenceModal.heading, `${locale} modal heading`)
      for (const [id, btn] of Object.entries(tx.mainBanner.buttons)) {
        assert.notEqual(btn.text, en.mainBanner.buttons[id]!.text, `${locale} banner button ${id}`)
      }
      for (const [id, btn] of Object.entries(tx.preferenceModal.buttons)) {
        assert.notEqual(btn.text, en.preferenceModal.buttons[id]!.text, `${locale} modal button ${id}`)
      }
      for (const [id, cat] of Object.entries(tx.preferenceModal.categories)) {
        assert.notEqual(cat.heading, en.preferenceModal.categories[id]!.heading, `${locale} ${id} heading`)
        assert.notEqual(cat.htmlText, en.preferenceModal.categories[id]!.htmlText, `${locale} ${id} text`)
        assert.equal(cat.legalBasis, en.preferenceModal.categories[id]!.legalBasis, 'translation never changes the legal basis')
      }
    }
  })
})

describe('DPDP labels (data)', () => {
  test('every shipped language has every label, and the draft label is the fixed English text', () => {
    const keys = Object.keys(DPDP_LABELS['en']!)
    for (const locale of DPDP_LOCALES) {
      const set = DPDP_LABELS[locale]
      assert.ok(set, locale)
      for (const key of keys) assert.ok((set as unknown as Record<string, string>)[key]?.trim(), `${locale}.${key}`)
      assert.equal(set.draftBadge, DPDP_DRAFT_BADGE)
    }
    assert.equal(DPDP_DRAFT_BADGE, 'DRAFT - REQUIRES LEGAL REVIEW')
  })

  test('region tags fall back to the language, unknown languages to English', () => {
    assert.equal(resolveDpdpLabels('hi-IN').reopenButton, DPDP_LABELS['hi']!.reopenButton)
    assert.equal(resolveDpdpLabels('ta').withdraw, DPDP_LABELS['ta']!.withdraw)
    assert.equal(resolveDpdpLabels('fr').reopenButton, DPDP_LABELS['en']!.reopenButton)
  })

  test('adding a language is data only: per-site labels for a new locale', () => {
    const labels = resolveDpdpLabels('mr', { mr: { reopenButton: 'गोपनीयता पर्याय', withdraw: 'संमती कधीही मागे घ्या.' } })
    assert.equal(labels.reopenButton, 'गोपनीयता पर्याय')
    assert.equal(labels.withdraw, 'संमती कधीही मागे घ्या.')
    assert.equal(labels.dataFiduciary, DPDP_LABELS['en']!.dataFiduciary, 'unset labels fall back to English')
  })

  test('the draft label cannot be relabelled away; blank overrides are ignored', () => {
    const labels = resolveDpdpLabels('en', { en: { draftBadge: 'Final', reopenButton: '   ' } })
    assert.equal(labels.draftBadge, DPDP_DRAFT_BADGE)
    assert.equal(labels.reopenButton, DPDP_LABELS['en']!.reopenButton)
  })
})

describe('grievance contact sanitising', () => {
  test('emails', () => {
    assert.equal(safeGrievanceEmail(' grievance@acme.example '), 'grievance@acme.example')
    assert.equal(safeGrievanceEmail('javascript:alert(1)'), null)
    assert.equal(safeGrievanceEmail('a@b'), null)
    assert.equal(safeGrievanceEmail('"><img>@x.y'), null)
    assert.equal(safeGrievanceEmail(undefined), null)
  })

  test('links must be https', () => {
    assert.equal(safeGrievanceUrl('https://acme.example/grievance'), 'https://acme.example/grievance')
    assert.equal(safeGrievanceUrl('http://acme.example'), null)
    assert.equal(safeGrievanceUrl('javascript:alert(1)'), null)
    assert.equal(safeGrievanceUrl('not a url'), null)
  })
})

// ─── In a real browser, against the built widget ─────────────────────────────

const UI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>DPDP flow test</title></head>
<body><main><h1>Test page</h1></main>
<script type="module">
  const config = JSON.parse(new URLSearchParams(location.search).get('config'))
  import('/ui/index.mjs').then(async ({ ConsentiSetup }) => {
    window.__widget = new ConsentiSetup(config)
    await window.__widget.ready
    window.__ready = true
  }).catch(e => { window.__error = String(e && e.stack || e) })
</script></body></html>`

const DPDPA = { dataFiduciary: 'Acme Pvt Ltd', grievanceEmail: 'grievance@acme.example', grievanceUrl: 'https://acme.example/grievance' }

type PlaywrightModule = typeof import('playwright')
type Browser = Awaited<ReturnType<PlaywrightModule['chromium']['launch']>>
type Page = Awaited<ReturnType<Browser['newPage']>>

describe('DPDP flow in the browser', () => {
  let server: Server
  let base = ''
  let browser: Browser | undefined
  let launchError = ''

  before(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/ui/')) {
        const file = normalize(join(UI_DIST, url.pathname.slice(4)))
        if (!file.startsWith(UI_DIST)) { res.writeHead(403).end(); return }
        try {
          const body = await readFile(file)
          res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(body)
        } catch { res.writeHead(404).end() }
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
    try {
      const { chromium } = await import('playwright')
      // CHROMIUM_PATH: use an already-installed Chromium when it doesn't match this Playwright version.
      const executablePath = process.env['CHROMIUM_PATH']
      browser = await chromium.launch(executablePath ? { executablePath } : {})
    } catch (err) {
      launchError = String(err)
    }
  })

  after(async () => {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  async function open(locale: string, extra: Record<string, unknown> = {}, dpdpa: Record<string, unknown> = DPDPA): Promise<Page> {
    if (!browser) throw new Error(`Chromium is required for this test (npx playwright install chromium): ${launchError}`)
    const config = {
      compliance: { type: 'opt-in-dpdpa' },
      core: { locale },
      autoInit: true,
      profileOverride: { dpdpa, ...extra },
    }
    // A context per page (not browser.newPage()) — axe-core's Playwright integration requires it.
    // Reduced motion: the widget then skips its fade-in, so axe measures final colours, not mid-animation ones.
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('close', () => { void context.close() })
    await page.goto(`${base}/?config=${encodeURIComponent(JSON.stringify(config))}`)
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean; __error?: string }).__ready || (window as unknown as { __error?: string }).__error)
    const error = await page.evaluate(() => (window as unknown as { __error?: string }).__error)
    assert.equal(error, undefined, error)
    return page
  }

  for (const locale of DPDP_LOCALES) {
    test(`renders the DPDP banner and modal in ${locale}`, async () => {
      const page = await open(locale)
      try {
        const tx = withLocaleOverlays('opt-in-dpdpa')!.translations[locale]!
        const labels = DPDP_LABELS[locale]!
        assert.equal(await page.getAttribute('.consenti-root', 'lang'), locale)
        assert.equal((await page.textContent('#consenti-banner-heading'))?.trim(), tx.mainBanner.heading)
        assert.equal((await page.textContent('#consenti-banner .consenti-dpdp__draft'))?.trim(), DPDP_DRAFT_BADGE)
        assert.equal(await page.locator('#consenti-banner .consenti-dpdp__purpose').count(), 5)
        assert.equal((await page.textContent('#consenti-banner .consenti-dpdp__withdraw'))?.trim(), labels.withdraw)
        assert.equal(await page.getAttribute('#consenti-banner .consenti-dpdp__grievance-email', 'href'), 'mailto:grievance@acme.example')
        assert.equal((await page.textContent('#consenti-banner #deny-all'))?.trim(), tx.mainBanner.buttons['deny-all']!.text)

        await page.click('#consenti-banner #review-choices')
        await page.waitForSelector('#consenti-modal')
        assert.equal((await page.textContent('#consenti-modal-heading'))?.trim(), tx.preferenceModal.heading)
        assert.equal((await page.textContent('#consenti-modal .consenti-dpdp__draft'))?.trim(), DPDP_DRAFT_BADGE)
        for (const [id, cat] of Object.entries(tx.preferenceModal.categories)) {
          assert.equal((await page.textContent(`#consenti-cat-${id}-heading`))?.trim(), cat.heading)
        }
      } finally {
        await page.close()
      }
    })
  }

  test('nothing is pre-ticked, even when a profile tries to pre-grant a purpose', async () => {
    const page = await open('en', { cookies: { analytics_storage: { preGrant: true } } })
    try {
      await page.click('#consenti-banner #review-choices')
      await page.waitForSelector('#consenti-modal')
      for (const id of ['functional', 'preferences', 'analytics', 'marketing']) {
        assert.equal(await page.getAttribute(`#consenti-modal [aria-labelledby="consenti-cat-${id}-heading"]`, 'aria-checked'), 'false', id)
      }
      assert.equal(await page.getAttribute('#consenti-modal [aria-labelledby="consenti-cat-necessary-heading"]', 'aria-checked'), 'true')

      await page.click('#consenti-modal #save-choices')
      const consent = await page.evaluate(() => (window as unknown as { __widget: { getConsent(): Record<string, string> } }).__widget.getConsent())
      assert.equal(consent['analytics_storage'], 'denied', 'saving without touching anything grants nothing optional')
      assert.equal(consent['security_storage'], 'granted')
    } finally {
      await page.close()
    }
  })

  test('granular choice, then withdrawal through the persistent control, by keyboard', async () => {
    const page = await open('en')
    try {
      assert.equal(await page.locator('#consenti-dpdp-reopen').count(), 0, 'no withdrawal control before a decision')
      await page.click('#consenti-banner #review-choices')
      await page.click('#consenti-modal [aria-labelledby="consenti-cat-analytics-heading"]')
      await page.click('#consenti-modal #save-choices')
      type W = { __widget: { getConsent(): Record<string, string> } }
      let consent = await page.evaluate(() => (window as unknown as W).__widget.getConsent())
      assert.equal(consent['analytics_storage'], 'granted')
      assert.equal(consent['ad_storage'], 'denied')
      assert.equal(consent['functionality_storage'], 'denied')

      const reopen = page.locator('#consenti-dpdp-reopen')
      assert.equal(await reopen.isVisible(), true)
      assert.equal((await reopen.textContent())?.trim(), DPDP_LABELS['en']!.reopenButton)
      assert.equal(await reopen.getAttribute('aria-label'), DPDP_LABELS['en']!.reopenAriaLabel)

      await reopen.focus()
      await page.keyboard.press('Enter')
      await page.waitForSelector('#consenti-modal')
      assert.equal(await page.getAttribute('#consenti-modal [aria-labelledby="consenti-cat-analytics-heading"]', 'aria-checked'), 'true', 'modal reflects the stored choice')
      await page.focus('#consenti-modal #withdraw-all')
      await page.keyboard.press('Enter')
      consent = await page.evaluate(() => (window as unknown as W).__widget.getConsent())
      assert.equal(consent['analytics_storage'], 'denied', 'withdrawn in one action')
      assert.equal(await reopen.isVisible(), true, 'the control stays available after withdrawal')
    } finally {
      await page.close()
    }
  })

  test('the control survives a reload for a returning visitor', async () => {
    const page = await open('hi')
    try {
      await page.click('#consenti-banner #deny-all')
      await page.reload()
      await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready)
      assert.equal(await page.locator('#consenti-banner:visible').count(), 0)
      assert.equal((await page.textContent('#consenti-dpdp-reopen'))?.trim(), DPDP_LABELS['hi']!.reopenButton)
    } finally {
      await page.close()
    }
  })

  test('reviewed notices drop the draft label; reopenControl: false drops the button', async () => {
    const page = await open('en', {}, { ...DPDPA, noticeStatus: 'reviewed', reopenControl: false })
    try {
      assert.equal(await page.locator('.consenti-dpdp__draft').count(), 0)
      await page.click('#consenti-banner #consent-all')
      assert.equal(await page.locator('#consenti-dpdp-reopen').count(), 0)
    } finally {
      await page.close()
    }
  })

  test('a new language added as data (labels only) renders without code changes', async () => {
    const page = await open('mr', {}, { ...DPDPA, labels: { mr: { withdraw: 'तुम्ही संमती कधीही मागे घेऊ शकता.' } } })
    try {
      assert.equal((await page.textContent('#consenti-banner .consenti-dpdp__withdraw'))?.trim(), 'तुम्ही संमती कधीही मागे घेऊ शकता.')
    } finally {
      await page.close()
    }
  })

  test('no serious or critical axe violations on the banner or the modal', async () => {
    const { AxeBuilder } = await import('@axe-core/playwright')
    const page = await open('hi')
    try {
      const serious = (r: { violations: Array<{ id: string; impact?: string | null }> }) =>
        r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)
      assert.deepEqual(serious(await new AxeBuilder({ page }).include('#consenti-banner').analyze()), [])
      await page.click('#consenti-banner #review-choices')
      await page.waitForSelector('#consenti-modal')
      assert.deepEqual(serious(await new AxeBuilder({ page }).include('#consenti-modal').analyze()), [])
    } finally {
      await page.close()
    }
  })
})
