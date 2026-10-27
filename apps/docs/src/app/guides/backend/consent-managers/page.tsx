import type { Metadata } from 'next'
import { CodeTabs } from '@/components/CodeTabs'
import { Callout } from '@/components/Callout'
import { RelatedDocs } from '@/components/RelatedDocs'

const TITLE = 'Consent Managers (DPDP) — Backend Guide'
const DESCRIPTION =
  'Receive consent given, changed or withdrawn through a registered DPDP Consent Manager with an adapter, and record it with receipts.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/guides/backend/consent-managers' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/guides/backend/consent-managers', images: ['/og-image.jpg'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.jpg'] },
}

export default function BackendConsentManagersGuide() {
  return (
    <div className="prose max-w-none">
      <h1>Consent Managers</h1>
      <p className="lead">
        Under the DPDP Act, people can give, change and withdraw consent through a registered
        Consent Manager. Ijazat receives those notifications through an adapter you configure,
        records them with signed receipts, and tells your systems. Ijazat is not a Consent Manager.
      </p>

      <Callout type="warning">
        The Consent Manager framework is new and message formats differ per Consent Manager. Not
        legal advice.
      </Callout>

      <h2>Flow</h2>
      <ol>
        <li>
          Configure an adapter: <code>{'createConsenti({ compliance: { consentManagers: [adapter] } })'}</code>.
        </li>
        <li>
          Register the notification URL with the Consent Manager:{' '}
          <code>/consenti/api/v1/consent-managers/&lt;adapter-id&gt;/notify</code> (plus{' '}
          <code>?tenant=</code> for several sites).
        </li>
        <li>
          The adapter authenticates each notification and returns a consent artefact: the
          Consent Manager&apos;s consent ID, an opaque person ID, a decision per purpose (your DPDP
          profile&apos;s category IDs) and a status (<code>active</code>, <code>withdrawn</code>,{' '}
          <code>expired</code>).
        </li>
        <li>
          Ijazat stores the artefact (person identified only by a hash), writes a receipt with source{' '}
          <code>consent_manager:&lt;id&gt;</code>, and emits <code>consent_manager:event</code>.
        </li>
      </ol>

      <CodeTabs
        tabs={[
          {
            label: 'Adapter',
            lang: 'typescript',
            code: `import type { ConsentManagerAdapter } from '@consenti/types'

export const exampleCm: ConsentManagerAdapter = {
  id: 'example-cm',
  name: 'Example Consent Manager',
  async verifyNotification({ headers, body }) {
    verifySignatureOrThrow(headers['x-cm-signature'], body)
    const msg = JSON.parse(body)
    return {
      type: msg.revoked ? 'consent.withdrawn' : 'consent.updated',
      artefact: {
        artefactId: msg.consent_id,
        principalRef: msg.principal_token,
        purposes: msg.purposes.map(p => ({ id: p.code, status: p.allowed ? 'granted' : 'denied' })),
        status: msg.revoked ? 'withdrawn' : 'active',
        givenAt: msg.created_at,
      },
    }
  },
}`,
          },
          {
            label: 'Act on withdrawal',
            lang: 'typescript',
            code: `eventBus.on('consent_manager:event', ({ type, principalRef }) => {
  if (type === 'consent.withdrawn') stopProcessingFor(principalRef)
})`,
          },
          {
            label: 'Mock (development)',
            lang: 'typescript',
            code: `import { MockConsentManager } from '@consenti/api'

const mock = new MockConsentManager({ secret: 'dev-only' })
const { headers, body } = mock.notification({
  type: 'consent.granted',
  artefact: { artefactId: 'a1', principalRef: 'p1', status: 'active', givenAt: new Date().toISOString(),
    purposes: [{ id: 'analytics', status: 'granted' }] },
})
// POST it to /consenti/api/v1/consent-managers/mock/notify`,
          },
        ]}
      />

      <h2>Responses</h2>
      <p>
        <code>200</code> recorded (an identical retry is accepted without a second receipt);{' '}
        <code>400</code> malformed artefact; <code>401</code> not verified by the adapter;{' '}
        <code>404</code> unknown adapter; <code>409</code> no active DPDP profile on the site;{' '}
        <code>413</code> body over 64 KB. Admin: <code>GET /consent-manager-artefacts</code>.
      </p>

      <RelatedDocs
        items={[
          { href: '/guides/backend/records', label: 'Records', desc: 'Consent receipts' },
          { href: '/guides/backend/consent-regimes', label: 'Consent Regimes', desc: 'DPDP routing per site' },
          { href: '/docs/api/events', label: 'Server events', desc: 'consent_manager:event' },
        ]}
      />
    </div>
  )
}
