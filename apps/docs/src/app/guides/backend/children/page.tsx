import type { Metadata } from 'next'
import { CodeTabs } from '@/components/CodeTabs'
import { Callout } from '@/components/Callout'
import { RelatedDocs } from '@/components/RelatedDocs'

const TITLE = "Children's Data (Age Gate & Parental Consent) — Backend Guide"
const DESCRIPTION =
  'What a visitor who answers the age gate as under age may consent to, how parental consent is requested and verified, and how to plug in a verification provider.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/guides/backend/children' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/guides/backend/children', images: ['/og-image.jpg'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.jpg'] },
}

export default function BackendChildrenGuide() {
  return (
    <div className="prose max-w-none">
      <h1>Children&apos;s Data</h1>
      <p className="lead">
        Hooks for sites that process children&apos;s data: an age gate on the profile, consent
        restrictions for children enforced in the widget and on the server, parental-consent
        requests with a full history, and an interface for plugging in a verification provider.
        Ijazat does not verify anyone&apos;s identity or age.
      </p>

      <Callout type="warning">
        Not legal advice. Whether your site needs an age gate, what counts as tracking or
        behavioural monitoring, and what counts as verifiable parental consent are questions for
        your lawyer.
      </Callout>

      <h2>Rules for a child</h2>
      <p>
        A visitor who answers the age gate as under <code>ageGate.minimumAge</code> is a child
        (the consent record has <code>ageVerified: false</code>; the widget keeps it in the consent
        cookie). Then, on every consent write, in the widget and on the server:
      </p>
      <ul>
        <li>Until a parent&apos;s consent is verified, every optional item is denied.</li>
        <li>
          After verification, the <strong>blocked purposes</strong> stay denied:{' '}
          <code>ageGate.blockedPurposes</code> (category IDs), or by default every category holding
          an item whose <code>purpose</code> is <code>analytics</code> or <code>marketing</code>.
        </li>
        <li>
          The consent receipt records <code>minor: &apos;parental_consent_pending&apos;</code> or{' '}
          <code>&apos;parental_consent_verified&apos;</code>.
        </li>
      </ul>
      <p>
        On a DPDP profile (<code>opt-in-dpdpa</code>), an enabled age gate must use{' '}
        <code>minimumAge</code> 18 or more; the profile routes reject anything lower.
      </p>

      <h2>Parental-consent requests</h2>
      <p>
        When a child declines the age gate with <code>requireParentalConsent: true</code>, the
        widget calls <code>POST /consenti/api/v1/consent/:visitorId/parental-consent-request</code>.
        The server records a request (hashed visitor ID only), starts it with the configured
        provider, and returns the signed token plus <code>requestId</code>, <code>status</code> and
        the provider&apos;s <code>redirectUrl</code> / <code>message</code>. A request becomes{' '}
        <code>verified</code> or <code>failed</code> through:
      </p>
      <ul>
        <li>the provider (checked while pending, whenever the status is read);</li>
        <li>
          the signed token, resolved by your own flow with{' '}
          <code>POST /consent/parental-consent-resolve</code> (method <code>site_token</code>);
        </li>
        <li>
          staff in the dashboard, <strong>Records → Parental consent</strong> (
          <code>PATCH /consenti/admin/v1/parental-consents/:id</code>, method <code>manual</code>,
          with a note).
        </li>
      </ul>
      <p>
        The child&apos;s widget reads <code>GET /consent/:visitorId/parental-consent</code> on page
        load while pending (or via <code>widget.checkParentalConsent()</code>) and fires{' '}
        <code>consenti:parentalConsentVerified</code> once verified.
      </p>

      <h2>Plugging in a provider</h2>
      <CodeTabs
        tabs={[
          {
            label: 'Interface',
            lang: 'typescript',
            code: `import type { ParentalConsentProvider } from '@consenti/types'

const provider: ParentalConsentProvider = {
  id: 'my-verifier',
  async start({ requestId, visitorRef, profileId, locale }) {
    const session = await myVerifier.createSession({ reference: requestId, locale })
    return { status: 'pending', providerRef: session.id, redirectUrl: session.url, message: 'Ask a parent to continue.' }
  },
  async check(providerRef) {
    const s = await myVerifier.getSession(providerRef)
    return { status: s.done ? (s.ok ? 'verified' : 'failed') : 'pending', providerRef, method: s.method }
  },
}

createConsenti({ compliance: { parentalConsentProvider: provider } })`,
          },
          {
            label: 'Mock (development)',
            lang: 'typescript',
            code: `import { createConsenti, MockParentalConsentProvider } from '@consenti/api'

// Verifies nothing. Refuses to start with NODE_ENV=production.
const mock = new MockParentalConsentProvider()          // or { autoApprove: true }
createConsenti({ compliance: { parentalConsentProvider: mock } })
// later, in a test: mock.approve(providerRef) / mock.reject(providerRef)`,
          },
        ]}
      />
      <p>
        <code>redirectUrl</code> must be <code>https://</code>; anything else is dropped. The
        provider never sees the raw visitor ID.
      </p>

      <RelatedDocs
        items={[
          { href: '/docs/compliance/coppa', label: 'COPPA', desc: 'The age gate and parental-consent token' },
          { href: '/guides/backend/records', label: 'Records', desc: 'Receipts and the dashboard Records page' },
          { href: '/docs/ui/methods', label: 'Widget methods', desc: 'getMinorStatus(), checkParentalConsent()' },
        ]}
      />
    </div>
  )
}
