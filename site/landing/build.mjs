// Builds the landing page into dist/index.html. The waitlist endpoint comes from the environment
// (WAITLIST_ENDPOINT, an https:// URL that accepts a JSON POST) so no endpoint, key or secret is
// ever committed. Without it, the form is replaced by a link to the repository.
//
//   WAITLIST_ENDPOINT=https://forms.example/ijazat node site/landing/build.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_URL = process.env.REPO_URL || 'https://github.com/ballaritechnologies/dpdp-consent'

export function validEndpoint(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url.toString()
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.toString()
  } catch {}
  throw new Error(`WAITLIST_ENDPOINT must be an https:// URL (got "${value}")`)
}

const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function form(endpoint) {
  return `<form id="waitlist-form" action="${escAttr(endpoint)}" method="post" novalidate>
      <div><label for="w-email">Work email</label>
        <input id="w-email" name="email" type="email" autocomplete="email" required></div>
      <div><label for="w-company">Company (optional)</label>
        <input id="w-company" name="company" type="text" autocomplete="organization" maxlength="120"></div>
      <div><label for="w-markets">Where are your users? (optional)</label>
        <select id="w-markets" name="markets">
          <option value="">Choose…</option>
          <option value="india">India only</option>
          <option value="india-eu-uk">India and EU/UK</option>
          <option value="india-us">India and the US</option>
          <option value="global">Global</option>
        </select></div>
      <div class="hp" aria-hidden="true"><label for="w-website">Leave this empty</label>
        <input id="w-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <label class="check"><input id="w-consent" name="consent" type="checkbox" required>
        <span>Email me when hosted Ijazat opens. I can unsubscribe at any time. My email is used for
        nothing else.</span></label>
      <button type="submit">Join the waitlist</button>
      <p role="status" id="w-status" aria-live="polite"></p>
    </form>`
}

const SCRIPT = `<script>
(function () {
  var form = document.getElementById('waitlist-form');
  if (!form) return;
  var status = document.getElementById('w-status');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { status.textContent = 'Please enter a valid email address.'; form.email.focus(); return; }
    if (!form.consent.checked) { status.textContent = 'Please tick the box so we may email you.'; form.consent.focus(); return; }
    if (form.website.value) { status.textContent = 'Thanks!'; return; }
    status.textContent = 'Sending…';
    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, company: form.company.value.trim(), markets: form.markets.value, consent: true, source: 'landing' })
    }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      form.reset(); status.textContent = "Thanks! You're on the list.";
    }).catch(function () { status.textContent = 'Something went wrong. Please try again later.'; });
  });
})();
</script>`

export async function build({ endpoint = process.env.WAITLIST_ENDPOINT, outDir = join(here, 'dist') } = {}) {
  const url = validEndpoint(endpoint)
  let html = await readFile(join(here, 'index.html'), 'utf8')
  html = html.replaceAll('__REPO_URL__', escAttr(REPO_URL))
  html = url
    ? html.replace('<!--WAITLIST_FORM-->', form(url)).replace('<!--WAITLIST_SCRIPT-->', SCRIPT)
    : html.replace('<!--WAITLIST_FORM-->', `<p>The waitlist isn't open yet. <a href="${escAttr(REPO_URL)}">Watch the repository</a> for news.</p>`).replace('<!--WAITLIST_SCRIPT-->', '')
  await mkdir(outDir, { recursive: true })
  const out = join(outDir, 'index.html')
  await writeFile(out, html)
  return { out, html, hasForm: !!url }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { out, hasForm } = await build()
  console.log(`Wrote ${out}${hasForm ? '' : ' (no WAITLIST_ENDPOINT set: form replaced by a repository link)'}`)
}
