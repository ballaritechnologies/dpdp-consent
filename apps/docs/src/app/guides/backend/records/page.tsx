import type { Metadata } from 'next'
import { CodeTabs } from '@/components/CodeTabs'
import { Callout } from '@/components/Callout'
import { RelatedDocs } from '@/components/RelatedDocs'

const TITLE = 'Records: Receipts, Notice Versions, Deletion Requests, Retention — Backend Guide'
const DESCRIPTION =
  'Signed consent receipts for every decision, notice version history, a deletion-request inbox with due dates, and purpose-based retention with automatic erasure.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/guides/backend/records' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/guides/backend/records', images: ['/og-image.jpg'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.jpg'] },
}

export default function BackendRecordsGuide() {
  return (
    <div className="prose max-w-none">
      <h1>Records</h1>
      <p className="lead">
        Four record types that help a site show what was decided, under which notice, and what it
        did with deletion requests. They live in one generic <code>entity_records</code> table
        (schema v4), on every storage driver, and are managed under <strong>Records</strong> in the
        dashboard.
      </p>

      <Callout type="warning">
        These records help you meet record-keeping duties; they do not make a site lawful by
        themselves and are not legal advice. Check retention periods and response times with your
        lawyer.
      </Callout>

      <h2>Consent receipts</h2>
      <p>
        Every consent write adds one receipt: <code>given</code> (first decision),{' '}
        <code>updated</code>, <code>withdrawn</code> (every optional purpose that was on is now
        off), <code>expired</code> (a purpose lapsed under the retention policy) or{' '}
        <code>erased</code> (the consent record was deleted). A receipt holds the per-purpose state
        (<code>granted</code> / <code>denied</code> / <code>partial</code>), the per-item decisions,
        the profile and its version, the DPDP notice version, the language, the source and the time.
      </p>
      <ul>
        <li>
          The visitor is identified only by an HMAC of their visitor ID (keyed with{' '}
          <code>compliance.dataSigningHash</code>), so receipts carry no raw identifier and are kept
          after the consent record is erased.
        </li>
        <li>
          Each receipt is signed (HMAC-SHA256 over its canonical JSON). The admin API returns{' '}
          <code>verified: false</code> for a receipt that was changed after it was written. Keep{' '}
          <code>CONSENTI_DATA_SIGNING_HASH</code> stable: changing it makes every existing receipt
          unverifiable and breaks the visitor lookup.
        </li>
      </ul>

      <h2>Notice versions</h2>
      <p>
        Each profile save records the profile version, the DPDP <code>noticeVersion</code> and
        review status (<code>draft</code> / <code>reviewed</code>), and a SHA-256 of the profile
        JSON. Two versions with the same hash showed the same notice. The full text stays in the
        profile&apos;s version history snapshots.
      </p>

      <h2>Deletion requests</h2>
      <p>
        Requests come from the widget (<code>POST /consenti/api/v1/consent/:visitorId/erasure-request</code>,
        with the visitor&apos;s ownership cookie) or are logged in the dashboard for email and other
        channels. Each has a due date (30 days by default, <code>erasureResponseDays</code> in the
        policy), a status and a history:
      </p>
      <p>
        <code>received</code> → <code>verifying</code> → <code>in_progress</code> →{' '}
        <code>completed</code> or <code>rejected</code>. Steps can be skipped; closed requests
        cannot change; rejecting needs a note. Completing with <code>eraseConsent: true</code>{' '}
        erases the visitor&apos;s consent record in the same step. Once closed, the raw visitor ID is
        dropped from the request. Every change is in the audit log, without contact details.
      </p>

      <h2>Retention</h2>
      <CodeTabs
        tabs={[
          {
            label: 'Policy',
            lang: 'javascript',
            code: `// PUT /consenti/admin/v1/retention/policy?tenantId=default
// Authorization: Bearer <token with settings:update>
{
  "purposeExpiryDays": { "analytics": 365, "marketing": 180 },
  "receiptDays": 2555,
  "closedErasureRequestDays": 365,
  "erasureResponseDays": 30
}`,
          },
          {
            label: 'Run',
            lang: 'javascript',
            code: `// POST /consenti/admin/v1/retention/run   (dry run unless dryRun: false)
{ "dryRun": true }

// 200
{ "dryRun": true, "ranAt": "…", "expired": [{ "visitorRef": "…", "purposes": ["analytics"] }],
  "receiptsDeleted": 0, "erasureRequestsDeleted": 0 }`,
          },
        ]}
      />
      <ul>
        <li>
          <strong>Purpose expiry:</strong> a granted purpose is switched to denied once its period
          has passed since the visitor last switched it on (read from their receipts). The change
          writes an <code>expired</code> receipt and emits <code>consent:purposes_expired</code>.
        </li>
        <li>
          <strong>Receipts</strong> older than <code>receiptDays</code> and <strong>closed
          requests</strong> made more than <code>closedErasureRequestDays</code> ago are deleted.
          Open requests are never deleted.
        </li>
        <li>
          Unset fields keep records. The job runs daily for every site (first run an hour after
          start); <code>POST /retention/run</code> runs it on demand.
        </li>
      </ul>

      <h2>Admin API</h2>
      <table>
        <thead><tr><th>Route</th><th>Permission</th></tr></thead>
        <tbody>
          <tr><td><code>GET /receipts</code> (<code>visitorId</code>, <code>action</code>, <code>from</code>, <code>to</code>)</td><td><code>consent:view</code></td></tr>
          <tr><td><code>GET /notice-versions</code> (<code>profileId</code>)</td><td><code>consent:view</code></td></tr>
          <tr><td><code>GET /erasure-requests</code> (<code>status</code>, <code>overdue=1</code>), <code>GET /erasure-requests/:id</code></td><td><code>consent:view</code></td></tr>
          <tr><td><code>POST /erasure-requests</code>, <code>PATCH /erasure-requests/:id</code></td><td><code>settings:update</code></td></tr>
          <tr><td><code>GET</code> / <code>PUT /retention/policy</code>, <code>POST /retention/run</code></td><td><code>consent:view</code> / <code>settings:update</code></td></tr>
          <tr><td><code>GET /export/receipts</code>, <code>/export/erasure-requests</code>, <code>/export/notice-versions</code> (<code>format=csv|json</code>)</td><td><code>export:run</code></td></tr>
        </tbody>
      </table>
      <p>
        All take <code>?tenantId=</code> (checked against the caller&apos;s allowed tenants). CSV
        cells that start with <code>=</code>, <code>+</code>, <code>-</code> or <code>@</code> are
        prefixed with <code>&apos;</code> so they do not run as spreadsheet formulas.
      </p>

      <h2>Upgrading</h2>
      <p>
        Schema v4 only adds the <code>entity_records</code> table (with three indexes). It runs on
        first start after the upgrade, on every SQL driver; MongoDB and the JSON file store need
        nothing. Consents recorded before the upgrade have no receipts; purpose expiry uses their
        last update time instead.
      </p>

      <RelatedDocs
        items={[
          { href: '/guides/backend/consent-flow', label: 'How Consent Flow Works', desc: 'Where receipts are written' },
          { href: '/guides/backend/consent-regimes', label: 'Consent Regimes', desc: 'DPDP / GDPR routing per site' },
          { href: '/docs/api/routes/admin', label: 'Admin API', desc: 'Every admin route' },
        ]}
      />
    </div>
  )
}
