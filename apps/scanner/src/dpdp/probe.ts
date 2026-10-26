import type { Page } from 'playwright'
import { launchSession } from '@consenti/browser-engine'
import {
  clickAcceptAll,
  clickRejectAll,
  detectBanner,
  listBannerButtons,
  listPreferenceCategoryStates,
  openPreferencePanel,
  visibleBannerText,
} from '../banner-detect.js'
import {
  ACCEPT_ALL_LABELS,
  BANNER_CONTAINER_SELECTORS,
  MANAGE_PREFERENCES_LABELS,
  REJECT_ALL_LABELS,
} from '../button-labels.js'
import { computeCrawlDelayMs } from '../crawl-delay.js'
import type { ScanOptions } from '../types.js'
import {
  GRIEVANCE_KEYWORDS,
  INDIAN_LANGUAGE_CODES,
  INDIAN_LANGUAGE_NAMES,
  INDIC_SCRIPT,
  WALL_TEXT,
  WITHDRAWAL_LABELS,
  WITHDRAWAL_SELECTORS,
} from './signals.js'
import type { DpdpPageProbe } from './types.js'

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase()
  return needles.some(n => lower.includes(n.toLowerCase()))
}

/** Runs browser-side code given as plain source text. Deliberately not a function reference:
 * tooling that rewrites functions (e.g. esbuild `keepNames`, used by tsx) injects helpers like
 * `__name` that don't exist inside the page, so a serialized function can throw there. */
async function inPage<T>(page: Page, source: string, arg: unknown, fallback: T): Promise<T> {
  try {
    return (await page.evaluate(`(${source})(${JSON.stringify(arg)})`)) as T
  } catch {
    return fallback
  }
}

const VISIBLE_JS = `function (el) {
  var r = el.getBoundingClientRect(); var s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
}`

async function openPage(url: string, options: ScanOptions) {
  const session = await launchSession(url, {
    headless: options.headless,
    navigationTimeoutMs: options.navigationTimeoutMs,
    handleProcessSignals: false,
  })
  await session.page.waitForTimeout(computeCrawlDelayMs(options.crawlDelaySeconds))
  return session
}

async function settle(page: Page, options: ScanOptions): Promise<void> {
  await page.waitForTimeout(options.settleTimeoutMs)
}

/** Indian-language evidence anywhere a visitor could pick or read a language. */
async function indianLanguageEvidence(page: Page, bannerText: string): Promise<string[]> {
  const evidence: string[] = []
  if (INDIC_SCRIPT.test(bannerText)) evidence.push('notice text in an Indian script')
  const pageSignals = await inPage<string[]>(page, `function (a) {
    var found = [];
    function primary(tag) { return String(tag || '').toLowerCase().split('-')[0]; }
    var htmlLang = document.documentElement.getAttribute('lang');
    if (a.codes.indexOf(primary(htmlLang)) >= 0) found.push('page language is "' + htmlLang + '"');
    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(function (link) {
      var lang = link.getAttribute('hreflang');
      if (a.codes.indexOf(primary(lang)) >= 0) found.push('alternate page for "' + lang + '"');
    });
    document.querySelectorAll('option, a, button, [role="option"], [role="menuitem"], li').forEach(function (el) {
      var raw = (el.textContent || '').trim(); var text = raw.toLowerCase();
      if (!text || text.length > 40) return;
      var named = a.names.some(function (n) { n = n.toLowerCase(); return text === n || text.indexOf(n + ' ') === 0 || text.slice(-n.length - 1) === ' ' + n; });
      if (named) found.push('language option "' + raw + '"');
      var lang = el.getAttribute('lang') || el.getAttribute('hreflang') || el.getAttribute('data-lang') || el.getAttribute('value');
      if (lang && a.codes.indexOf(primary(lang)) >= 0) found.push('language option for "' + lang + '"');
    });
    return found;
  }`, { names: INDIAN_LANGUAGE_NAMES, codes: INDIAN_LANGUAGE_CODES }, [])
  for (const item of pageSignals) if (!evidence.includes(item)) evidence.push(item)
  return evidence.slice(0, 10)
}

async function scrollLocked(page: Page): Promise<boolean> {
  return inPage(page, `function () {
    function hidden(el) { var s = getComputedStyle(el); return s.overflow === 'hidden' || s.overflowY === 'hidden'; }
    return hidden(document.documentElement) || hidden(document.body);
  }`, null, false)
}

/** The notice is still in the way when one of its accept/reject buttons is still visible — a
 * stricter test than banner detection, whose generic fallback also matches a site's own floating
 * "Privacy choices" button. */
async function noticeStillShown(page: Page): Promise<boolean> {
  return inPage(page, `function (a) {
    var visible = ${VISIBLE_JS};
    return Array.prototype.some.call(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'), function (el) {
      if (!visible(el)) return false;
      var text = ((el.textContent || '') + ' ' + (el.getAttribute('value') || '')).toLowerCase();
      return a.labels.some(function (l) { return text.indexOf(l.toLowerCase()) >= 0; });
    });
  }`, { labels: [...ACCEPT_ALL_LABELS, ...REJECT_ALL_LABELS] }, false)
}

async function bodyText(page: Page): Promise<string> {
  return inPage(page, `function () { return document.body ? document.body.innerText : ''; }`, null, '')
}

/** A visible reopen control outside any banner container: a known CMP selector, or a button/link
 * whose text or aria-label reads like "Privacy choices" / "Cookie settings". */
async function findWithdrawalControl(page: Page): Promise<string | null> {
  return inPage<string | null>(page, `function (a) {
    var visible = ${VISIBLE_JS};
    function insideBanner(el) {
      return a.bannerSelectors.some(function (sel) {
        try { var c = el.closest(sel); return !!c && visible(c); } catch (e) { return false; }
      });
    }
    for (var i = 0; i < a.selectors.length; i++) {
      var el = document.querySelector(a.selectors[i]);
      if (el && visible(el)) return a.selectors[i];
    }
    var candidates = document.querySelectorAll('button, a, [role="button"]');
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      if (!visible(c) || insideBanner(c)) continue;
      var text = ((c.textContent || '') + ' ' + (c.getAttribute('aria-label') || '')).toLowerCase();
      for (var k = 0; k < a.labels.length; k++) {
        if (text.indexOf(a.labels[k].toLowerCase()) >= 0) return '"' + ((c.textContent || '').trim() || c.getAttribute('aria-label')) + '"';
      }
    }
    return null;
  }`, { selectors: WITHDRAWAL_SELECTORS, labels: WITHDRAWAL_LABELS, bannerSelectors: BANNER_CONTAINER_SELECTORS }, null)
}

/**
 * Runs the DPDP-specific checks on one page in three fresh browser sessions: as first shown (the
 * notice, its buttons, the preferences panel, languages, grievance contact), after "Accept all"
 * and a reload (is there a way back to withdraw?), and after "Reject all" (is the site still
 * usable?). Every step degrades to a note rather than failing the probe.
 */
export async function probeDpdpPage(url: string, options: ScanOptions): Promise<DpdpPageProbe> {
  const probe: DpdpPageProbe = {
    url,
    bannerFound: false,
    bannerText: '',
    bannerButtons: [],
    hasAcceptOption: false,
    hasRejectOption: false,
    hasManageOption: false,
    categories: null,
    grievanceOnBanner: false,
    grievanceOnPage: false,
    indianLanguageEvidence: [],
    withdrawalControl: null,
    wallEvidence: [],
    notes: [],
  }

  try {
    const first = await openPage(url, options)
    try {
      await settle(first.page, options)
      probe.bannerFound = await detectBanner(first.page)
      if (probe.bannerFound) {
        probe.bannerText = await visibleBannerText(first.page)
        probe.bannerButtons = await listBannerButtons(first.page)
        probe.hasAcceptOption = probe.bannerButtons.some(b => includesAny(b, ACCEPT_ALL_LABELS))
        probe.hasRejectOption = probe.bannerButtons.some(b => includesAny(b, REJECT_ALL_LABELS))
        probe.hasManageOption = probe.bannerButtons.some(b => includesAny(b, MANAGE_PREFERENCES_LABELS))
        probe.grievanceOnBanner = includesAny(probe.bannerText, GRIEVANCE_KEYWORDS)
        if (!probe.hasRejectOption && (await scrollLocked(first.page))) {
          probe.wallEvidence.push('the page cannot be scrolled while the notice is open, and the notice has no reject option')
        }
        if (includesAny(probe.bannerText, WALL_TEXT)) probe.wallEvidence.push('the notice says the site needs consent to continue')
      }
      const text = await bodyText(first.page)
      probe.grievanceOnPage = includesAny(text, GRIEVANCE_KEYWORDS)
      probe.indianLanguageEvidence = await indianLanguageEvidence(first.page, probe.bannerText)
      if (probe.bannerFound) {
        if (await openPreferencePanel(first.page)) {
          probe.categories = await listPreferenceCategoryStates(first.page)
          const panelText = await visibleBannerText(first.page)
          if (!probe.grievanceOnBanner) probe.grievanceOnBanner = includesAny(panelText, GRIEVANCE_KEYWORDS)
          if (INDIC_SCRIPT.test(panelText) && !probe.indianLanguageEvidence.includes('notice text in an Indian script')) {
            probe.indianLanguageEvidence.unshift('notice text in an Indian script')
          }
        } else {
          probe.notes.push('no preferences panel could be opened')
        }
      }
    } finally {
      await first.close()
    }

    if (probe.bannerFound && probe.hasAcceptOption) {
      const accepted = await openPage(url, options)
      try {
        await settle(accepted.page, options)
        if (await clickAcceptAll(accepted.page)) {
          await settle(accepted.page, options)
          await accepted.page.reload({ waitUntil: 'domcontentloaded' })
          await settle(accepted.page, options)
          if (await noticeStillShown(accepted.page)) probe.notes.push('the notice appeared again after accepting and reloading, so the choice may not be stored')
          probe.withdrawalControl = await findWithdrawalControl(accepted.page)
        } else {
          probe.notes.push('could not click "Accept all"')
        }
      } finally {
        await accepted.close()
      }
    } else if (probe.bannerFound) {
      probe.notes.push('no "Accept all" option, so the withdrawal control was not checked')
    }

    if (probe.bannerFound && probe.hasRejectOption) {
      const rejected = await openPage(url, options)
      try {
        await settle(rejected.page, options)
        if (await clickRejectAll(rejected.page)) {
          await settle(rejected.page, options)
          if (await noticeStillShown(rejected.page)) probe.wallEvidence.push('the notice is still shown after "Reject all"')
          if (await scrollLocked(rejected.page)) probe.wallEvidence.push('the page stays locked (no scrolling) after "Reject all"')
          if (includesAny(await bodyText(rejected.page), WALL_TEXT)) probe.wallEvidence.push('after "Reject all" the page says consent is needed to continue')
        } else {
          probe.notes.push('could not click "Reject all"')
        }
      } finally {
        await rejected.close()
      }
    }
  } catch (err) {
    probe.error = err instanceof Error ? err.message : String(err)
  }
  return probe
}
