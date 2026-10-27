# Breach incidents

The **Incidents** page in the dashboard is a log for personal data breaches. It counts down to the
72-hour report deadline, reminds you as it approaches, and drafts the notices for the Data
Protection Board and the people affected.

> Not legal advice. Ijazat never sends a notice: every draft is labelled
> `DRAFT - REQUIRES LEGAL REVIEW` and must be reviewed, completed and sent by you. Open points are
> Q-B1 to Q-B4 in [legal-open-questions.md](./legal-open-questions.md).

## What the DPDP Rules expect (summary)

On becoming aware of a personal data breach, a Data Fiduciary must (DPDP Rules 2025, rule 7):

- tell each affected person without delay: what happened, the likely consequences, what you have
  done, what they can do, and who to contact;
- tell the Data Protection Board without delay: a description of the breach, its nature, extent,
  timing, location and likely impact;
- within **72 hours** of becoming aware (or longer if the Board allows), send the Board a detailed
  report: updated facts, the circumstances and reasons, mitigation, findings on who caused it,
  remedial measures, and the notices given to affected people.

GDPR has a similar 72-hour deadline for the supervisory authority (Art. 33) and a duty to tell
people when the risk is high (Art. 34).

## Logging an incident

**Incidents → Log an incident.** The required fields are a title, what happened, when you became
aware of the breach, and its severity. "Became aware at" starts the clock: the Board report is due
72 hours later. Fill in the rest as you learn more: every change goes into the incident's history
and the audit log.

Statuses: open → contained → reported → closed (you can move between them freely).

## The deadline and reminders

The incident list and page show the time left, amber under 24 hours and red once overdue. A job
checks every 15 minutes and emits a `breach:deadline` server event at 48, 24 and 6 hours left
and when the deadline passes (one per check, skipping any that were missed). It stops once you
record the detailed report as sent. Forward the event to your team:

```ts
const { eventBus } = createConsenti({ /* … */ })
eventBus.on('breach:deadline', ({ incidentId, title, threshold, dueAt }) => {
  notifyOnCall(`Breach "${title}" (${incidentId}): Board report ${threshold === 'overdue' ? 'OVERDUE' : `due in ${threshold}`}, by ${dueAt}`)
})
```

## Drafting notices

On an incident, pick a language and click **Board intimation**, **Board report (72h)** or
**Notice to people**. The draft is filled from the incident and shown for copying or download. A
language without its own template uses English; Hindi is built in for the notice to people.

The text comes from editable files in `apps/api/templates/breach/` (shipped as
`dist/templates/breach/`). To use your own wording, copy that folder, edit it, and set
`compliance.breachTemplatesDir` to your copy; any file you leave out falls back to the built-in
one. Placeholders such as `{{organisation}}` and `{{reportDueAt}}` are listed in the folder's
README. Empty fields render as `[to be completed]`, and the draft label is added if a template
leaves it out.

When you have sent something, click **Mark as sent now** next to it under "What you have sent".

## Export

`GET /consenti/admin/v1/export/incidents?format=csv|json` (permission `export:run`) or
**Export CSV** on the list.

## Permissions

Viewing incidents and drafting notices needs `audit:view`; logging and changing them needs
`settings:update`.
