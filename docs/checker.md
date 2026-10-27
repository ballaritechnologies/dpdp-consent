# The DPDP consent checker

The checker visits a website in a real (headless) browser on your machine and lists **gaps** it
finds against common DPDP consent expectations. It works on any site, not only sites that use
Ijazat.

> The report lists gaps found by automated checks. It does not say whether a site meets the DPDP
> Act or any other law, it can miss things, and it is not legal advice.

## Run it

```bash
npm ci
npx turbo build --filter=@consenti/scanner...
npx playwright install chromium        # once
node apps/scanner/dist/cli.js dpdp https://example.com --probe-pages 2
```

Useful options: `--depth <n>` and `--page-limit <n>` (how much to crawl), `--probe-pages <n>` (how
many pages get the DPDP checks; each costs three page loads), `--crawl-delay <s>` (be gentle with
the site), `--output-dir <dir>`. The command exits with code 1 when gaps are found, so you can use
it in CI.

Output, in `<output-dir>/<scan-id>/`:

- `dpdp-report.html`: the readable report: a summary, every check with its result, and each gap
  with what was seen, where, and how to fix it.
- `dpdp-report.json`: the same, for tooling.
- `scan-results.html` / `.json`: the full tracker scan underneath.

**Privacy:** nothing is uploaded. The only network traffic is the browser visiting the site.

## The checks

| Check | Gap when… | How to fix |
|---|---|---|
| A consent notice is shown | No banner is found at all | Show a notice before optional processing, one choice per purpose |
| No tracking before the visitor chooses | Analytics, advertising or fingerprinting runs before any choice | Block those tags by default; release them from your consent tool after consent |
| No tracking after "Reject all" | They still run after "Reject all" was clicked | Make "Reject all" stop them and clear what they set |
| Consent is not pre-ticked or bundled | Optional switches start on; optional purposes are locked on; only "Accept" is offered; refusing takes more steps | All optional purposes off by default; a "Reject all" next to "Accept all"; essential-only can be locked |
| Consent can be withdrawn later | After accepting, no "Privacy choices"/"Cookie settings" control is visible | Keep a persistent control that reopens the choices |
| A grievance contact is given | No grievance officer or contact in the notice or on the page | Name a grievance contact in the notice and on your privacy page |
| The notice is offered in an Indian language | No Indian-language text or language option | Offer the notice in Indian languages your visitors use, with a visible switcher |
| The site works without optional consent | The page stays locked or keeps showing the notice after "Reject all", or says "accept to continue" | Let people use the site after refusing optional purposes |

Each check reports **gaps found**, **no gaps found**, or **not checked** (with the reason, for
example "no Reject all option to test"). Gaps are rated high, medium or low.

## Limits

The checker relies on heuristics: common banner layouts and button labels (in English, several
European languages, Hindi, Kannada, Telugu and Tamil), known consent-tool selectors, and tracker
lists. Banners inside cross-origin iframes, geo-gated banners and bot-blocking sites can be missed.
Treat "no gaps found" as "nothing obvious", not as a clean bill of health. The detection lists are
plain data in [`apps/scanner/src/dpdp/signals.ts`](../apps/scanner/src/dpdp/signals.ts):
contributions welcome.

## As a library

```ts
import { runDpdpCheck, writeDpdpReport, DEFAULT_SCAN_OPTIONS } from '@consenti/scanner'

const { report } = await runDpdpCheck('https://example.com', { ...DEFAULT_SCAN_OPTIONS, dpdpProbePages: 2 })
await writeDpdpReport(report, './scan-results')
```

`evaluateDpdp(scanReport, probes)` is the pure rule engine if you want to supply your own data.
