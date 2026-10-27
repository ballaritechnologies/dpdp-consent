# Children's data

The DPDP Act treats anyone under 18 as a child. A site that processes children's personal data
needs verifiable consent from a parent or lawful guardian, and must not track, behaviourally
monitor or target advertising at children. Ijazat gives you hooks for this; it does not verify
anyone's identity or age.

> Not legal advice. Whether your site needs an age gate at all, what counts as tracking or
> behavioural monitoring, and which exemptions apply are questions for your lawyer: see Q-C1 to
> Q-C4 in [legal-open-questions.md](./legal-open-questions.md).

## Turning on the age gate

On the profile (dashboard: **Profile editor → Step 1**), enable the age gate with a minimum age and
"Require parental consent". On a DPDP profile the minimum age must be 18 or more.

```json
{ "ageGate": { "enabled": true, "minimumAge": 18, "requireParentalConsent": true } }
```

The age gate appears before the consent banner on a visitor's first visit. It is self-declared:
a visitor can answer anything.

## What happens for a child

1. The visitor answers "No". Ijazat records a refusal of every optional purpose and remembers
   that this visitor is a child (in the consent cookie and on the consent record).
2. A parental-consent request is opened on the server and, if you configured a verification
   provider, started with it. The widget fires `consenti:parentalConsentRequired` with a signed
   token, and the server fires `consent.parentalConsentRequired`, for your own flow.
3. Until the request is **verified**, every optional purpose stays off. In the preferences panel
   those purposes are shown switched off and locked, with a note.
4. Once it is verified, the child can choose again, except for the **blocked purposes**, which stay
   off for good: by default every category holding an analytics or advertising item, or the list
   you set in `ageGate.blockedPurposes`.

The widget and the server both enforce these rules. Every consent receipt for a child records
whether parental consent was pending or verified.

## Verifying a parent

A request becomes verified in one of three ways:

- **A verification provider.** Implement the `ParentalConsentProvider` interface (`start()` and
  `check()`) for the service you use, and pass it as `compliance.parentalConsentProvider`. The
  provider sees only a hashed visitor ID. `MockParentalConsentProvider` is for development only:
  it verifies nothing and refuses to run in production.
- **Your own flow and the signed token.** Send the token from `consent.parentalConsentRequired` to
  the parent; when your flow is satisfied, resolve it with `POST /consent/parental-consent-resolve`
  (or the widget's `resolveParentalConsent()`).
- **Staff, in the dashboard.** **Records → Parental consent** lists requests; staff can record an
  outcome they verified outside Ijazat, such as a signed form, with a note.

The visitor's widget checks for a verified request on each page load while consent is pending, or
when you call `widget.checkParentalConsent()`. Listen for `consenti:parentalConsentVerified` to
reopen the preferences panel.

## Limits

- The age gate is self-declared and can be answered falsely or reset by clearing cookies.
- Ijazat does not decide whether your site is directed at children or whether an exemption
  applies.
- Blocked purposes are decided by category, so keep advertising and analytics items in their own
  categories.
