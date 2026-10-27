# Records: receipts, notice versions, deletion requests, retention

Ijazat keeps four kinds of record so a site can show what a visitor decided, under which notice,
and what it did with deletion requests. Find them in the dashboard under **Records**.

> These records help you meet record-keeping duties under the DPDP Act and GDPR. They do not make
> a site lawful by themselves, and this is not legal advice. Check retention periods and response
> times with your lawyer; the open points are Q-P1 to Q-P4 in
> [legal-open-questions.md](./legal-open-questions.md).

## Consent receipts

Every consent decision adds a receipt:

| Action | When |
|---|---|
| `given` | the visitor's first decision |
| `updated` | a later change |
| `withdrawn` | every optional purpose that was on is now off |
| `expired` | a purpose was switched off by its retention period |
| `erased` | the visitor's consent record was deleted |

A receipt holds each purpose's state (on, off, or partly on), each item's decision, the profile
and its version, the DPDP notice version, the language, the source and the time.

- **No raw visitor ID.** Receipts identify the visitor by a keyed hash (HMAC) of the visitor ID, so
  they stay as evidence after the consent record is erased. To find a visitor's receipts, search
  with their full visitor ID: the server hashes it the same way.
- **Signed.** Each receipt is signed with the server's `CONSENTI_DATA_SIGNING_HASH`. The dashboard
  shows "Signature does not match" for a receipt that was changed after it was written. Keep that
  secret stable: changing it makes old receipts unverifiable and breaks the visitor lookup.

## Notice versions

Each time a profile is saved, Ijazat records the profile version, the DPDP notice version and its
review status (draft or reviewed), and a fingerprint (SHA-256) of the profile. Two versions with
the same fingerprint showed the same notice. The full text of every version is in the profile's
**Version history**; receipts say which notice version a visitor saw.

## Deletion requests

The inbox collects requests:

- from the widget: `POST /consenti/api/v1/consent/<visitorId>/erasure-request` (the visitor's own
  browser, with an optional contact and message);
- from email, phone or anywhere else: **Records → Deletion requests → New request**.

Each request gets a due date (30 days by default; change it with "New requests are due in" under
Retention) and moves through **Received → Verifying → In progress → Completed / Rejected**. Steps
can be skipped, closed requests can't be reopened, and a rejection needs a reason. Completing a
request can also erase the visitor's consent record in the same step. Overdue requests are counted
and highlighted. Every change goes into the request's history and the audit log (without the
requester's contact details).

`DELETE /consenti/api/v1/consent/<visitorId>` still erases the consent record immediately; it
writes an `erased` receipt.

## Retention

Under **Records → Retention**, per site:

- **Purpose expiry:** for example `analytics: 365`. A purpose a visitor switched on is switched off
  that many days later, unless they switched it on again since. This writes an `expired` receipt.
- **Keep receipts for** and **keep closed requests for:** older records are deleted. Open requests
  are never deleted.
- Empty fields keep everything.

A job applies the policy every day for every site. **Preview** shows what it would change without
changing anything; **Run now** applies it.

## Export

Receipts, deletion requests and notice versions export as CSV or JSON (Records tabs, or
`GET /consenti/admin/v1/export/receipts|erasure-requests|notice-versions?format=csv|json`). The
deletion-request export contains contact details: handle it as personal data.

## API

See the "Records" section of [apps/api/README.md](../apps/api/README.md) and the OpenAPI spec at
`/consenti/api/docs`.
