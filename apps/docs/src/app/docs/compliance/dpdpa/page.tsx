import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/CodeBlock'
import { Callout } from '@/components/Callout'
import { ComplianceTierBadge } from '@/components/ComplianceTierBadge'

export const metadata: Metadata = {
  title: 'DPDPA Compliance Guide (India 2023)',
  description:
    "DPDPA compliance guide for Consenti — India's Digital Personal Data Protection Act 2023, enforced by the Data Protection Board of India.",
  alternates: { canonical: '/docs/compliance/dpdpa' },
  openGraph: {
    title: 'DPDPA Compliance Guide (India 2023)',
    description:
      "DPDPA compliance guide for Consenti — India's Digital Personal Data Protection Act 2023, enforced by the Data Protection Board of India.",
    url: 'https://consenti.dev/docs/compliance/dpdpa',
    siteName: 'Consenti Docs',
    images: ['/og-image.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DPDPA Compliance Guide (India 2023)',
    description:
      "DPDPA compliance guide for Consenti — India's Digital Personal Data Protection Act 2023, enforced by the Data Protection Board of India.",
    images: ['/og-image.jpg'],
  },
}

export default function DPDPAPage() {
  return (
    <div className="prose max-w-none">
      <h1>DPDPA Compliance Guide</h1>
      <ComplianceTierBadge tier="in-development" />
      <Callout type="info">
        <strong>Compliance group:</strong> <code>opt-in-dpdpa</code> — India-specific opt-in with
        fiduciary name, grievance officer in modal, and age gate (18+). GPC signal is ignored. Use{' '}
        <code>compliance: {"{ type: 'opt-in-dpdpa' }"}</code> in your <code>ConsentiSetup</code>{' '}
        config.
      </Callout>
      <p>
        India's Digital Personal Data Protection Act 2023 (DPDPA) came into force in August 2023 and
        is enforced by the Data Protection Board of India under the Ministry of Electronics and
        Information Technology (MeitY).
      </p>

      <Callout type="warning">
        <strong>Status: in development, tracking a phased rollout.</strong> The DPDP Rules 2025
        were notified 13 November 2025. Consent Manager provisions take effect 13 November 2026;
        the remaining substantive compliance obligations become binding 13 May 2027. Consenti's
        DPDPA support ships today and evolves alongside this timeline — treat it as actively
        maintained, not yet an independently audited implementation of the final rules.
      </Callout>

      <h2>Official references</h2>
      <ul>
        <li>
          <a
            href="https://www.meity.gov.in/content/digital-personal-data-protection-act-2023"
            target="_blank"
            rel="noopener noreferrer"
          >
            Ministry of Electronics and Information Technology (MeitY) — DPDPA 2023
          </a>{' '}
          — official Act page
        </li>
        <li>
          <a
            href="https://egazette.gov.in/WriteReadData/2023/247302.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            India Gazette Notification — DPDPA 2023 (PDF)
          </a>{' '}
          — official gazette text of the Act
        </li>
        <li>
          <a href="https://www.meity.gov.in/" target="_blank" rel="noopener noreferrer">
            MeitY — Ministry of Electronics and Information Technology
          </a>
        </li>
      </ul>

      <h2>Key requirements</h2>
      <table>
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Compliance Group</td>
            <td>Opt-in — no silent or pre-ticked consent</td>
          </tr>
          <tr>
            <td>GPC</td>
            <td>
              Not recognised under DPDPA — Consenti ignores GPC when regulation is{' '}
              <code>'dpdpa'</code>
            </td>
          </tr>
          <tr>
            <td>Data Fiduciary disclosure</td>
            <td>Name of the entity collecting data must appear in the consent notice</td>
          </tr>
          <tr>
            <td>Grievance Officer</td>
            <td>Email address for complaints must be disclosed in the consent notice</td>
          </tr>
          <tr>
            <td>Purpose</td>
            <td>Processing purpose must be described in clear, plain language</td>
          </tr>
          <tr>
            <td>Withdrawal</td>
            <td>Must be as easy as giving consent</td>
          </tr>
          <tr>
            <td>Minors</td>
            <td>Under-18 requires verifiable parental consent (Section 9)</td>
          </tr>
        </tbody>
      </table>

      <h2>DPDPA vs. GDPR</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>GDPR</th>
            <th>DPDPA</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Opt-in required</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>GPC honoured</td>
            <td>Optional</td>
            <td>Not applicable</td>
          </tr>
          <tr>
            <td>Data Fiduciary name in notice</td>
            <td>Not required in banner</td>
            <td>Required</td>
          </tr>
          <tr>
            <td>Grievance Officer in notice</td>
            <td>Not required in banner</td>
            <td>Required</td>
          </tr>
          <tr>
            <td>Sensitive categories</td>
            <td>GDPR Art. 9 special categories</td>
            <td>Sensitive personal data (Chapter III)</td>
          </tr>
          <tr>
            <td>Enforcer</td>
            <td>Data Protection Authorities</td>
            <td>Data Protection Board of India</td>
          </tr>
        </tbody>
      </table>

      <h2>Enabling DPDPA mode</h2>
      <h3>Frontend widget</h3>
      <CodeBlock
        lang="ts"
        code={`new ConsentiSetup({
  // GPC handling isn't relevant — it's not recognised under DPDPA
  compliance: { type: 'opt-in-dpdpa' },
})`}
      />

      <h3>Profile configuration (dashboard)</h3>
      <p>
        In the <strong>Profile Editor</strong>, select <strong>DPDPA (India 2023)</strong> as the
        regulation. The <strong>DPDP notice details</strong> section appears:
      </p>
      <ul>
        <li><strong>Data Fiduciary Name</strong> (required): your company or product name.</li>
        <li><strong>Grievance Officer Email</strong> (required): where visitors send questions and complaints.</li>
        <li><strong>Purpose Description</strong>, <strong>Grievance officer</strong> name, <strong>Grievance / contact page</strong> (https) and <strong>Notice version</strong> (all optional).</li>
        <li><strong>Persistent &quot;Privacy choices&quot; button</strong> (on by default).</li>
        <li><strong>Notice reviewed by our lawyer</strong>: until ticked, a visible <code>DRAFT - REQUIRES LEGAL REVIEW</code> label is shown.</li>
      </ul>

      <h3>Programmatic profile JSON</h3>
      <CodeBlock
        lang="json"
        code={`{
  "regulation": "dpdpa",
  "dpdpa": {
    "dataFiduciary": "Acme Corp Pvt Ltd",
    "grievanceEmail": "grievance@acme.example",
    "grievanceOfficer": "R. Sharma",
    "grievanceUrl": "https://acme.example/grievance",
    "purposeDescription": "To operate the website and send transactional emails.",
    "noticeVersion": "2026-10",
    "noticeStatus": "draft",
    "reopenControl": true,
    "labels": { "mr": { "reopenButton": "गोपनीयता पर्याय" } }
  }
}`}
      />
      <p>
        Without a server, pass the same block as <code>profileOverride: {'{ dpdpa: { ... } }'}</code>{' '}
        in the widget config.
      </p>

      <h2>The DPDP flow</h2>
      <p>For <code>opt-in-dpdpa</code> profiles the widget renders:</p>
      <ul>
        <li>
          <strong>An itemised notice.</strong> The banner lists every purpose separately (Essential,
          Enhanced features, Preferences, Analytics, Advertising); the preferences panel describes
          each one: what data, for what purpose.
        </li>
        <li>
          <strong>Granular, unbundled consent.</strong> One switch per purpose; only the essential
          purpose is always on. Optional purposes start switched off. The widget ignores{' '}
          <code>preGrant</code> for DPDP visitors, and the profile validator reports it as an error.
        </li>
        <li><strong>Reject as prominent as accept</strong> on the banner.</li>
        <li>
          <strong>Data Fiduciary and grievance contact</strong> on both the banner and the
          preferences panel.
        </li>
        <li>
          <strong>Withdrawal as easy as consent:</strong> after a decision, a persistent
          &quot;Privacy choices&quot; button (bottom corner, keyboard accessible) reopens the panel,
          where &quot;Reject all&quot; withdraws everything in one action.
        </li>
        <li>
          <strong>Languages:</strong> English, Hindi (<code>hi</code>), Kannada (<code>kn</code>),
          Telugu (<code>te</code>) and Tamil (<code>ta</code>) ship built in, with the locale
          switcher on the banner. The widget sets <code>lang</code> on its root so screen readers
          use the right voice.
        </li>
        <li>
          <strong>A visible <code>DRAFT - REQUIRES LEGAL REVIEW</code> label</strong> until{' '}
          <code>noticeStatus</code> is <code>&quot;reviewed&quot;</code>. The built-in notice
          text is a starting point, not reviewed legal wording.
        </li>
      </ul>

      <h3>Adding a language</h3>
      <p>Adding a language never needs a code change:</p>
      <ul>
        <li>
          <strong>Per site:</strong> add the locale&apos;s notice text in the Profile Editor (or{' '}
          <code>localeContent</code> via the API), and its short UI labels under{' '}
          <code>dpdpa.labels[locale]</code>.
        </li>
        <li>
          <strong>Built in:</strong> add an overlay file under{' '}
          <code>packages/utils/src/profiles/opt-in-dpdpa/</code>, register it in{' '}
          <code>PROFILE_LOCALES</code>, and add its labels to <code>DPDP_LABELS</code> in{' '}
          <code>packages/utils/src/dpdp-labels.ts</code>.
        </li>
      </ul>

      <h2>GPC under DPDPA</h2>
      <Callout type="warning">
        DPDPA does not recognise GPC as an opt-out signal. Even if the visitor's browser sends
        <code>navigator.globalPrivacyControl === true</code>, the widget does not automatically deny
        cookies under DPDPA. The banner is always shown on first visit for an explicit choice.
      </Callout>

      <h2>Erasure (Section 12)</h2>
      <p>
        DPDPA Section 12 grants users the right to erasure. Use the GDPR-compatible erasure
        endpoint:
      </p>
      <CodeBlock lang="http" code={`DELETE /consenti/api/v1/consent/:visitorId`} />
      <p>This removes all consent records, history, and visitor data for the given visitor ID.</p>
      <p>
        For the widget-side &quot;Forget me&quot; button and the events both sides fire, see the{' '}
        <Link href="/guides/hot-topics/right-to-erasure">Right to Erasure guide</Link>.
      </p>
    </div>
  )
}
