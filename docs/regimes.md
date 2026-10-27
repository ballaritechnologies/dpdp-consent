# Choosing a regime

A **regime** decides which consent flow each visitor of a site gets. It is set per site (tenant) in
the dashboard under **Settings → Consent regime**, or through the admin API. It needs the widget's
geo routing: `compliance: { type: 'auto' }` with `api.enabled: true`.

| Regime | India | EU / EEA / UK | Everyone else | Unknown location |
|---|---|---|---|---|
| *none* (default) | upstream's jurisdiction map, unchanged | | | |
| `dpdp` | DPDP | DPDP | DPDP | DPDP |
| `dpdp_gdpr` | DPDP | GDPR (`opt-in`) | your default group | your default group |
| `strictest_global` | not available yet | | | |

"EU / EEA / UK" means the 27 EU countries, Iceland, Liechtenstein, Norway and the United Kingdom
(`GB` or `UK`). Switzerland gets the default group.

> Choosing a regime only decides which flow is shown. It is not legal advice; see the open
> questions Q-R1 to Q-R4 in [legal-open-questions.md](./legal-open-questions.md).

## Which one?

- **Mostly Indian audience, few EU visitors:** `dpdp`. One flow, simplest to review.
- **Selling in the EU/UK and India:** `dpdp_gdpr`, with a default group that suits your other
  markets (for example `opt-out` for US-state privacy laws, or `opt-in` to be cautious).
- **Not sure:** start with `dpdp_gdpr` and default `opt-in`, then ask your lawyer.

## What has to be in place

1. **An active profile for every group the regime can send visitors to.** `dpdp` needs
   `opt-in-dpdpa`; `dpdp_gdpr` needs `opt-in-dpdpa`, `opt-in` and your default group. The setup
   wizard seeds these; without one, the widget falls back to its built-in profile.
2. **The DPDP notice details** on the DPDP profile: Data Fiduciary, grievance email, and
   optionally an officer name, a grievance page and a notice version.
3. **A geo provider you trust.** The default guesses from timezone and language. For `dpdp_gdpr`
   in production, configure `geoip` or `maxmind` (see [apps/api/README.md](../apps/api/README.md)).

## API

```http
PATCH /consenti/admin/v1/settings?tenantId=default
Authorization: Bearer <token with settings:update>
Content-Type: application/json

{ "regime": "dpdp_gdpr", "regimeDefaultGroup": "opt-out" }
```

Send `null` to clear either field. `strictest_global` returns `501` until it is implemented. Every
change is written to the audit log as `settings:regime_updated`.

## Several sites

With `multiTenant: { enabled: true }`, each site (tenant) has its own regime and profiles. The
widget sends its `core.tenantId` to the server, which applies that site's regime. In the
dashboard, the regime card shows a site picker when there is more than one site.

## Returning visitors

A visitor who has already decided keeps the flow they decided under until their consent expires
(the profile's `expiryDays`, 365 by default) or they clear it. Changing the regime affects new
visitors straight away.
