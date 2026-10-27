// Fails when user-facing text claims compliance (CONTRIBUTING.md, "No compliance claims").
// Scans docs, READMEs, locale files, notice templates, the landing page and report wording.
// Technical uses ("OIDC-compliant provider", "guaranteed schema") are allowed by the patterns below.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const FORBIDDEN = /\b(non-?compliant|compliant|certified|legally valid)\b|\bguarantee[sd]?\b(?=[^.\n]{0,40}\b(complian|lawful|legal|DPDP|GDPR)\b)/i
const ALLOWED = [/OIDC-compliant/i, /spec-compliant/i, /non-spec-compliant/i]

const INCLUDE = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'NOTICE', 'docs', 'apps/ui/README.md', 'apps/api/README.md',
  'apps/scanner/README.md', 'apps/docs/src', 'apps/api/locale', 'packages/utils/src/profiles',
  'packages/utils/src/dpdp-labels.ts', 'apps/scanner/src/dpdp', 'site/landing',
]
// Files that quote the rule itself or upstream text kept for reference.
const SKIP = new Set(['CONTRIBUTING.md', 'docs/upstream-readme.md', 'docs/audit.md', 'docs/legal-open-questions.md', 'site/landing/build.test.mjs'])

function* walk(path) {
  const st = statSync(path)
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === 'node_modules' || name === 'dist' || name === '.next' || name === '__tests__') continue
      yield* walk(join(path, name))
    }
  } else if (/\.(md|tsx?|json|html|mjs)$/.test(path) || path.endsWith('NOTICE')) {
    yield path
  }
}

const problems = []
for (const entry of INCLUDE) {
  for (const file of walk(join(ROOT, entry))) {
    const rel = relative(ROOT, file)
    if (SKIP.has(rel)) continue
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (FORBIDDEN.test(line) && !ALLOWED.some(a => a.test(line))) problems.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`)
    })
  }
}

if (problems.length > 0) {
  console.error(`Compliance-claim wording found (see CONTRIBUTING.md, "No compliance claims"):\n${problems.join('\n')}`)
  process.exit(1)
}
console.log('Wording check: no compliance claims found.')
