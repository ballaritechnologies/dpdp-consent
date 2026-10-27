# Roadmap

What Ijazat plans to build, in order. Dates are targets, not promises. Every legal point is
reviewed by a lawyer before we describe a feature as ready; open points live in
[legal-open-questions.md](./legal-open-questions.md).

## v0.1 (this release)

- Per-site regimes: `dpdp`, `dpdp_gdpr`
- DPDP consent flow: itemised notice, one choice per purpose, nothing pre-ticked, persistent
  withdrawal control, grievance contact, English + Hindi + Kannada + Telugu + Tamil, DRAFT labels
- DPDP consent checker (CLI + library) with JSON and HTML gap reports
- Docker quickstart built from source

## v0.2: records (built, not yet released)

- Consent receipts stored on the server for every decision: purposes, decision, notice version,
  language, time, and a hashed visitor ID
- Notice version history
- Deletion-request inbox with status, due dates and an audit trail
- Purpose-based retention with automatic erasure jobs
- CSV and JSON export of all of the above

## v0.3: children and breaches (children's data hooks built, not yet released)

- Age gate and a pluggable parental-consent provider interface (no identity verification of our
  own); tracking, behavioural and advertising purposes blocked by default for under-18s
- Breach incident module: incident form, 72-hour countdown with reminders, DRAFT notices for the
  Data Protection Board and affected people, incident log

## Later

- `strictest_global` regime: one flow meeting the union of DPDP and GDPR requirements
- Adapter interface for registered Consent Managers (interface and mock only; Ijazat is not a
  Consent Manager)
- More Indian languages (data-only additions; native-speaker review welcome)
- Rebranding the bundled documentation site, and publishing packages under an Ijazat npm scope
- Finishing multi-tenant isolation in the admin API (see [audit.md](./audit.md), section 2)

## Hosted version

Ballari Technologies plans a hosted Ijazat (India-region hosting, billing in USD and INR). It is
built in a separate private repository; the open-source project stays fully usable on its own.
