import type { Metadata } from 'next'
import { CodeTabs } from '@/components/CodeTabs'
import { Callout } from '@/components/Callout'
import { RelatedDocs } from '@/components/RelatedDocs'

const TITLE = 'Consent Regimes (DPDP / GDPR) — Backend Guide'
const DESCRIPTION =
  'Choose per site whether every visitor gets the India DPDP consent flow, or DPDP for India and GDPR for the EU/EEA/UK.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/guides/backend/consent-regimes' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/guides/backend/consent-regimes', images: ['/og-image.jpg'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.jpg'] },
}

export default function BackendConsentRegimesGuide() {
  return (
    <div className="prose max-w-none">
      <h1>Consent Regimes (DPDP / GDPR)</h1>
      <p className="lead">
        A <strong>regime</strong> is a per-site routing policy. It sits in front of the
        jurisdiction map and decides which consent flow (compliance group) each visitor is sent to.
        It does not add a new compliance group, and a site with no regime keeps exactly the
        jurisdiction-map routing it had before.
      </p>

      <Callout type="warning">
        Choosing a regime only decides which consent flow is shown. It is not legal advice. Check
        with your lawyer which flow your site needs.
      </Callout>

      <h2>The regimes</h2>
      <table>
        <thead>
          <tr>
            <th>Regime</th>
            <th>India</th>
            <th>EU / EEA / UK</th>
            <th>Everyone else</th>
            <th>Unknown location</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><em>unset</em></td>
            <td colSpan={4}>Jurisdiction map, unchanged (see Geo-Routing)</td>
          </tr>
          <tr>
            <td><code>dpdp</code></td>
            <td><code>opt-in-dpdpa</code></td>
            <td><code>opt-in-dpdpa</code></td>
            <td><code>opt-in-dpdpa</code></td>
            <td><code>opt-in-dpdpa</code></td>
          </tr>
          <tr>
            <td><code>dpdp_gdpr</code></td>
            <td><code>opt-in-dpdpa</code></td>
            <td><code>opt-in</code></td>
            <td><code>regimeDefaultGroup</code> (default <code>opt-in</code>)</td>
            <td><code>regimeDefaultGroup</code> (default <code>opt-in</code>)</td>
          </tr>
          <tr>
            <td><code>strictest_global</code></td>
            <td colSpan={4}>
              <code>opt-in-dpdpa</code> for everyone, hardened: GPC is honoured as a refusal of
              advertising (widget and server) and consent expires after at most 365 days.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        &quot;EU / EEA / UK&quot; means the 27 EU member states, Iceland, Liechtenstein, Norway and
        the United Kingdom. The UK matches as both <code>GB</code> (the ISO code geo providers
        return) and <code>UK</code>. Switzerland is not in this list, so under{' '}
        <code>dpdp_gdpr</code> it gets the default group. Country codes are matched without regard
        to case or surrounding spaces.
      </p>

      <h2>Requirements</h2>
      <ul>
        <li>
          The server runs with <code>{"compliance.type: 'auto'"}</code> (geo routing), and the
          widget uses <code>{"compliance.type: 'auto'"}</code>. A widget pinned to a fixed group
          fetches that group directly and is not affected by the regime.
        </li>
        <li>
          An <strong>active profile</strong> exists for each group the regime can route to:{' '}
          <code>opt-in-dpdpa</code> for <code>dpdp</code>; <code>opt-in-dpdpa</code>,{' '}
          <code>opt-in</code> and your default group for <code>dpdp_gdpr</code>. Otherwise{' '}
          <code>/resolve-profile</code> answers <code>found: false</code> and the widget falls back
          to its pre-built profile.
        </li>
        <li>
          For <code>dpdp_gdpr</code>, use an IP-based <code>geoDataProvider</code> (
          <code>geoip</code> or <code>maxmind</code>) in production. The default timezone/language
          heuristic can misplace visitors.
        </li>
      </ul>

      <h2>Setting a regime</h2>
      <p>
        In the dashboard: <strong>Settings → Consent regime</strong>. If you run several sites
        (multi-tenant), pick the site first. Or use the admin API:
      </p>
      <CodeTabs
        tabs={[
          {
            label: 'DPDP + GDPR',
            lang: 'javascript',
            code: `// PATCH /consenti/admin/v1/settings?tenantId=default
// Authorization: Bearer <token with settings:update>
{ "regime": "dpdp_gdpr", "regimeDefaultGroup": "opt-out" }`,
          },
          {
            label: 'DPDP for everyone',
            lang: 'javascript',
            code: `// PATCH /consenti/admin/v1/settings
{ "regime": "dpdp" }`,
          },
          {
            label: 'Clear',
            lang: 'javascript',
            code: `// PATCH /consenti/admin/v1/settings
{ "regime": null, "regimeDefaultGroup": null }`,
          },
        ]}
      />
      <p>
        Every regime change is written to the audit log as <code>settings:regime_updated</code>,
        with the old and new values.
      </p>

      <h2>Multiple sites</h2>
      <p>
        Each site (tenant) has its own regime. With <code>multiTenant.enabled</code>, the widget
        sends its <code>core.tenantId</code> (or <code>api.tenantId</code>) to{' '}
        <code>/resolve-profile</code> as <code>?tenant=</code>, and the server uses that site&apos;s
        regime and active profiles. Without multi-tenant mode the parameter is ignored and the
        default site is used.
      </p>

      <h2>Returning visitors</h2>
      <p>
        A visitor who already decided keeps the flow recorded in their consent cookie: the widget
        skips <code>/resolve-profile</code> and fetches that group&apos;s profile directly. A regime
        change therefore reaches returning visitors when their consent expires (the profile&apos;s{' '}
        <code>expiryDays</code>) or when they clear it.
      </p>

      <RelatedDocs
        items={[
          { href: '/guides/backend/geo-routing', label: 'Geo-Routing & Auto-Detection', desc: 'How the jurisdiction map resolves a group' },
          { href: '/docs/compliance/compliance-groups', label: 'Compliance Groups', desc: 'What each group does' },
          { href: '/docs/api/routes/admin', label: 'Admin API', desc: 'GET / PATCH /settings' },
        ]}
      />
    </div>
  )
}
