import type { DpdpCheckResult, DpdpGap, DpdpReport } from './types.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const RESULT_TEXT: Record<DpdpCheckResult['result'], string> = {
  'gaps-found': 'Gaps found',
  'no-gaps-found': 'No gaps found',
  'not-checked': 'Not checked',
}

function gapCard(gap: DpdpGap): string {
  const evidence = gap.evidence.length > 0
    ? `<details><summary>What was found (${gap.evidence.length})</summary><ul>${gap.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>`
    : ''
  const pages = gap.pages.length > 0
    ? `<p class="pages">Pages: ${gap.pages.map(p => `<code>${esc(p)}</code>`).join(', ')}</p>`
    : ''
  return `<article class="gap gap--${gap.severity}">
  <h3><span class="sev">${gap.severity}</span> ${esc(gap.title)}</h3>
  <p>${esc(gap.detail)}</p>
  <p class="fix"><strong>How to fix:</strong> ${esc(gap.fix)}</p>
  ${pages}
  ${evidence}
</article>`
}

/** Self-contained HTML (no external assets, no scripts) for the DPDP gap report. */
export function renderDpdpHtml(report: DpdpReport): string {
  const rows = report.checks.map(c => `<tr><td>${esc(c.title)}</td><td class="r r--${c.result}">${RESULT_TEXT[c.result]}</td><td>${esc(c.note ?? '')}</td></tr>`).join('')
  const bySeverity = (s: DpdpGap['severity']) => report.gaps.filter(g => g.severity === s).length
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DPDP gap report: ${esc(report.startUrl)}</title>
<style>
  :root { --bg:#fff; --fg:#1a2433; --muted:#556070; --line:#d9dee5; --high:#b42318; --medium:#b54708; --low:#1d4ed8; --ok:#067647; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12161c; --fg:#e6e9ee; --muted:#a3acb9; --line:#2b323c; --high:#f97066; --medium:#fdb022; --low:#84adff; --ok:#47cd89; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, -apple-system, sans-serif; }
  main { max-width:880px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:18px; margin:32px 0 12px; } h3 { font-size:16px; margin:0 0 6px; }
  .meta, .pages, td:last-child { color:var(--muted); font-size:13px; }
  .summary { display:flex; flex-wrap:wrap; gap:12px; margin:16px 0; }
  .summary div { border:1px solid var(--line); border-radius:8px; padding:10px 14px; min-width:110px; }
  .summary strong { display:block; font-size:22px; }
  .disclaimer { border-left:4px solid var(--medium); padding:8px 12px; background:color-mix(in srgb, var(--medium) 8%, transparent); }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .r--gaps-found { color:var(--high); font-weight:600; } .r--no-gaps-found { color:var(--ok); } .r--not-checked { color:var(--muted); }
  .gap { border:1px solid var(--line); border-left-width:5px; border-radius:8px; padding:12px 16px; margin:12px 0; }
  .gap--high { border-left-color:var(--high); } .gap--medium { border-left-color:var(--medium); } .gap--low { border-left-color:var(--low); }
  .sev { text-transform:uppercase; font-size:11px; letter-spacing:.05em; padding:2px 6px; border-radius:4px; border:1px solid currentColor; margin-right:6px; }
  .gap--high .sev { color:var(--high); } .gap--medium .sev { color:var(--medium); } .gap--low .sev { color:var(--low); }
  code { overflow-wrap:anywhere; }
</style>
</head>
<body>
<main>
  <h1>DPDP gap report</h1>
  <p class="meta"><code>${esc(report.startUrl)}</code> · checked ${esc(report.checkedAt)} · scan <code>${esc(report.scanId)}</code>${report.partial ? ' · <strong>partial: stopped early</strong>' : ''}</p>
  <div class="summary">
    <div><strong>${report.gapsFound}</strong>gaps found</div>
    <div><strong>${bySeverity('high')}</strong>high</div>
    <div><strong>${bySeverity('medium')}</strong>medium</div>
    <div><strong>${bySeverity('low')}</strong>low</div>
    <div><strong>${report.pagesChecked.length}</strong>pages probed</div>
  </div>
  <p class="disclaimer">${esc(report.disclaimer)} Generated on your machine; nothing was uploaded.</p>
  <h2>Checks</h2>
  <table><thead><tr><th>Check</th><th>Result</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Gaps found</h2>
  ${report.gaps.length > 0 ? report.gaps.map(gapCard).join('\n') : '<p>The automated checks found no gaps. That does not mean there are none.</p>'}
</main>
</body>
</html>
`
}
