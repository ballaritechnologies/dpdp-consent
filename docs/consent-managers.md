# Consent Managers

Under the DPDP Act, a **Consent Manager** is a company registered with the Data Protection Board
through which a person can give, manage, review and withdraw consent across many Data Fiduciaries
(s.6(7)–(9)). A site whose users come through a Consent Manager must accept consent given that way
and act on withdrawals it reports.

**Ijazat is not a Consent Manager** and does not offer to act as one. It gives you an adapter
interface to receive a Consent Manager's notifications, record them like any other consent, and
tell your systems.

> Not legal advice, and the Consent Manager framework is still being set up (registrations
> expected around November 2026). Message formats are defined by each Consent Manager. Open points:
> Q-M1 to Q-M3 in [legal-open-questions.md](./legal-open-questions.md).

## How it works

1. You write (or install) an adapter for the Consent Manager you work with and pass it to the
   server:

   ```ts
   createConsenti({ compliance: { consentManagers: [myConsentManagerAdapter] } })
   ```

2. You give the Consent Manager your notification URL:
   `https://<your-server>/consenti/api/v1/consent-managers/<adapter-id>/notify`
   (add `?tenant=<site>` when you run several sites).

3. For each notification, the adapter checks it really came from the Consent Manager (signature,
   mutual TLS, whatever that Consent Manager uses) and returns a **consent artefact**: the
   Consent Manager's ID for the consent, an opaque ID for the person, and a decision per purpose.
   Purposes are the category IDs of your DPDP profile (`necessary`, `functional`, `preferences`,
   `analytics`, `marketing` in the built-in one).

4. Ijazat checks the artefact, stores it (the person is identified only by a hash), writes a
   signed consent receipt with source `consent_manager:<adapter-id>`, and emits
   `consent_manager:event`. **Act on withdrawals** in your listener:

   ```ts
   eventBus.on('consent_manager:event', ({ type, principalRef, consent }) => {
     if (type === 'consent.withdrawn') stopProcessingFor(principalRef)
   })
   ```

A retried, identical notification is accepted without a second receipt. Notifications the adapter
can't verify get `401`; malformed ones `400`; a site without an active DPDP profile `409`.

In the admin API, `GET /consenti/admin/v1/consent-manager-artefacts` lists what was received.

## Writing an adapter

```ts
import type { ConsentManagerAdapter } from '@consenti/types'

export const exampleCm: ConsentManagerAdapter = {
  id: 'example-cm',
  name: 'Example Consent Manager',
  async verifyNotification({ headers, body }) {
    verifySignatureOrThrow(headers['x-cm-signature'], body)   // their scheme
    const msg = JSON.parse(body)
    return {
      type: msg.event === 'REVOKED' ? 'consent.withdrawn' : 'consent.updated',
      artefact: {
        artefactId: msg.consent_id,
        principalRef: msg.principal_token,
        purposes: msg.purposes.map((p: { code: string; allowed: boolean }) => ({ id: p.code, status: p.allowed ? 'granted' : 'denied' })),
        status: msg.event === 'REVOKED' ? 'withdrawn' : 'active',
        givenAt: msg.created_at,
      },
    }
  },
}
```

`MockConsentManager` (exported from `@consenti/api`) is a development stand-in that signs
notifications with a shared secret: `mock.notification(event)` builds one. It refuses to start
with `NODE_ENV=production`.
