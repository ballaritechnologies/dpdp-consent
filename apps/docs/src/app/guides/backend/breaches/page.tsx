import type { Metadata } from 'next'
import { CodeTabs } from '@/components/CodeTabs'
import { Callout } from '@/components/Callout'
import { RelatedDocs } from '@/components/RelatedDocs'

const TITLE = 'Breach Incidents — Backend Guide'
const DESCRIPTION =
  'Log personal data breaches, count down to the 72-hour Data Protection Board report, get reminders, and draft notices from editable templates.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/guides/backend/breaches' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/guides/backend/breaches', images: ['/og-image.jpg'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/og-image.jpg'] },
}

export default function BackendBreachesGuide() {
  return (
    <div className="prose max-w-none">
      <h1>Breach Incidents</h1>
      <p className="lead">
        An incident log in the dashboard (<strong>Incidents</strong>) with a countdown to the
        72-hour report to the Data Protection Board, reminders as it approaches, and DRAFT notices
        for the Board and the people affected, filled from editable template files.
      </p>

      <Callout type="warning">
        Ijazat never sends a notice. Every draft starts with{' '}
        <code>DRAFT - REQUIRES LEGAL REVIEW</code>; review, complete and send it yourself. This is
        not legal advice.
      </Callout>

      <h2>The incident</h2>
      <p>
        Required: <code>title</code>, <code>description</code>, <code>discoveredAt</code> (when you
        became aware; starts the clock) and <code>severity</code>. Optional: when it happened and
        was contained, nature and cause, data categories, approximate number and location of people
        affected, systems, likely impact, measures taken, what people can do, and the contact
        details used in notices. Status: <code>open</code>, <code>contained</code>,{' '}
        <code>reported</code>, <code>closed</code>. Every change is in the incident history and the
        audit log. <code>dueAt</code> is the report deadline: <code>discoveredAt</code> + 72 hours.
      </p>

      <h2>Reminders</h2>
      <p>
        Every 15 minutes the server emits <code>breach:deadline</code> for incidents whose
        deadline is 48, 24 or 6 hours away, or past (one per incident per check, skipping missed
        ones), until you record the detailed report as sent.
      </p>
      <CodeTabs
        tabs={[
          {
            label: 'Forward reminders',
            lang: 'typescript',
            code: `eventBus.on('breach:deadline', ({ incidentId, title, threshold, hoursLeft, dueAt }) => {
  // threshold: '48h' | '24h' | '6h' | 'overdue'
  pageOnCall(\`Breach "\${title}": Board report due \${dueAt} (\${hoursLeft}h left)\`)
})`,
          },
        ]}
      />

      <h2>Draft notices</h2>
      <p>
        <code>POST /consenti/admin/v1/incidents/:id/notices</code> with <code>kind</code> (
        <code>board-intimation</code>, <code>board-report</code>, <code>user-notice</code>) and{' '}
        <code>locale</code> returns the filled text. Templates live in{' '}
        <code>templates/breach/&lt;kind&gt;.&lt;locale&gt;.md</code> (English for all three, Hindi for
        the notice to people); a missing locale falls back to English. Set{' '}
        <code>compliance.breachTemplatesDir</code> to use your own wording; files you leave out fall
        back to the built-in ones. Empty fields render as <code>[to be completed]</code>.
      </p>
      <p>
        Record what you sent with <code>POST /incidents/:id/milestones</code> (
        <code>boardIntimatedAt</code>, <code>boardReportSentAt</code>, <code>usersNotifiedAt</code>).
      </p>

      <h2>Permissions</h2>
      <p>
        <code>audit:view</code> to read incidents and draft notices; <code>settings:update</code> to
        log and change them; <code>export:run</code> for <code>GET /export/incidents</code>.
      </p>

      <RelatedDocs
        items={[
          { href: '/guides/backend/records', label: 'Records', desc: 'Receipts, deletion requests, retention' },
          { href: '/docs/api/events', label: 'Server events', desc: 'breach:deadline and others' },
          { href: '/docs/api/routes/admin', label: 'Admin API', desc: 'Every admin route' },
        ]}
      />
    </div>
  )
}
