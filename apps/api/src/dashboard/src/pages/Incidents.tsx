import { useEffect, useState } from 'preact/hooks'
import type { BreachIncident, BreachIncidentFields, BreachMilestone, BreachNoticeKind, BreachSeverity, BreachStatus, PagedResult } from '@consenti/types'
import { usePageTitle } from '../context/pageTitle'
import { useT } from '../context/locale'
import { useAuth } from '../context/auth'
import { DataTable } from '../components/DataTable'
import { Select } from '../components/Select'
import { apiDownload, apiErrorMessage, apiFetch } from '../api/client'
import type { TranslationKey } from '../utils/t'

const STATUSES: BreachStatus[] = ['open', 'contained', 'reported', 'closed']
const SEVERITIES: BreachSeverity[] = ['low', 'medium', 'high', 'critical']
const MILESTONES: BreachMilestone[] = ['boardIntimatedAt', 'boardReportSentAt', 'usersNotifiedAt']
const NOTICES: BreachNoticeKind[] = ['board-intimation', 'board-report', 'user-notice']
const NOTICE_LOCALES = ['en', 'hi', 'kn', 'te', 'ta']

const btn = 'px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const input = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm'
const card = 'bg-white rounded-lg border border-gray-200 p-5'

type IncidentList = PagedResult<BreachIncident> & { now: string }

function fmt(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

/** `datetime-local` value (local time) ↔ ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

/** "47h 12m left" / "overdue by 3h 05m" / "report sent". */
function useCountdown(t: ReturnType<typeof useT>) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return (i: BreachIncident): { text: string; tone: 'ok' | 'warn' | 'late' | 'done' } => {
    if (i.data.boardReportSentAt) return { text: t('incidents.countdown.sent'), tone: 'done' }
    if (i.status === 'closed' || !i.dueAt) return { text: '—', tone: 'done' }
    const ms = Date.parse(i.dueAt) - now
    const abs = Math.abs(ms)
    const h = Math.floor(abs / 3_600_000)
    const m = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0')
    if (ms < 0) return { text: t('incidents.countdown.overdue', { h, m }), tone: 'late' }
    return { text: t('incidents.countdown.left', { h, m }), tone: h < 24 ? 'warn' : 'ok' }
  }
}

const TONE: Record<string, string> = { ok: 'text-gray-700', warn: 'text-amber-700 font-medium', late: 'text-red-700 font-semibold', done: 'text-gray-500' }

/** Personal data breach incidents: log, 72-hour countdown, milestones, DRAFT notices. */
export function Incidents({ current }: { current: string }) {
  const t = useT()
  usePageTitle(t('incidents.title'))
  const m = current.match(/^#\/incidents\/([\w-]+)/)
  return (
    <div class="space-y-4">
      <p class="text-xs text-amber-700">{t('incidents.notLegalAdvice')}</p>
      {m ? <IncidentDetail id={m[1]!} /> : <IncidentList />}
    </div>
  )
}

function IncidentList() {
  const t = useT()
  const { user } = useAuth()
  const canEdit = !!user?.permissions.includes('settings:update')
  const countdown = useCountdown(t)
  const [data, setData] = useState<IncidentList | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: String(pageSize), ...(status ? { status } : {}) })
    apiFetch<IncidentList>(`/incidents?${q}`)
      .then(setData)
      .catch(err => setError(apiErrorMessage(err, t('incidents.error'))))
      .finally(() => setLoading(false))
  }, [page, pageSize, status])

  return (
    <>
      <p class="text-xs text-gray-500">{t('incidents.hint')}</p>
      {canEdit && !creating && <button class={btn} onClick={() => setCreating(true)}>{t('incidents.new')}</button>}
      {creating && (
        <IncidentForm
          submitLabel={t('incidents.create')}
          onCancel={() => setCreating(false)}
          onSubmit={async fields => {
            const created = await apiFetch<BreachIncident>('/incidents', { method: 'POST', body: JSON.stringify(fields) })
            window.location.hash = `#/incidents/${created.id}`
          }}
        />
      )}
      {error && <p role="alert" class="text-sm text-red-600">{error}</p>}
      <DataTable
        loading={loading}
        rows={(data?.items ?? []) as unknown as Record<string, unknown>[]}
        keyFn={r => (r as unknown as BreachIncident).id}
        filters={
          <Select
            options={[{ value: '', label: t('incidents.allStatuses') }, ...STATUSES.map(s => ({ value: s, label: t(`incidents.status.${s}` as TranslationKey) }))]}
            value={status}
            onChange={v => { setStatus(v); setPage(1) }}
          />
        }
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={n => { setPageSize(n); setPage(1) }}
        toolbarEnd={<button onClick={() => { void apiDownload('/export/incidents?format=csv') }} class="text-sm text-blue-600 hover:underline">{t('common.exportCsv')}</button>}
        columns={[
          { key: 'title', label: t('incidents.field.title'), render: r => <a class="text-blue-600 hover:underline" href={`#/incidents/${(r as unknown as BreachIncident).id}`}>{(r as unknown as BreachIncident).data.title}</a> },
          { key: 'severity', label: t('incidents.field.severity'), render: r => t(`incidents.severity.${(r as unknown as BreachIncident).data.severity}` as TranslationKey) },
          { key: 'status', label: t('common.status'), render: r => t(`incidents.status.${(r as unknown as BreachIncident).status}` as TranslationKey) },
          { key: 'discoveredAt', label: t('incidents.field.discoveredAt'), render: r => fmt((r as unknown as BreachIncident).data.discoveredAt) },
          {
            key: 'dueAt', label: t('incidents.col.reportDue'), render: r => {
              const c = countdown(r as unknown as BreachIncident)
              return <span class={TONE[c.tone]}>{c.text}</span>
            },
          },
        ]}
        emptyText={t('incidents.empty')}
      />
    </>
  )
}

function IncidentDetail({ id }: { id: string }) {
  const t = useT()
  const { user } = useAuth()
  const canEdit = !!user?.permissions.includes('settings:update')
  const countdown = useCountdown(t)
  const [incident, setIncident] = useState<BreachIncident | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ kind: BreachNoticeKind; text: string; template: string } | null>(null)
  const [noticeLocale, setNoticeLocale] = useState('en')

  const load = () => apiFetch<BreachIncident>(`/incidents/${encodeURIComponent(id)}`).then(setIncident).catch(err => setError(apiErrorMessage(err, t('incidents.error'))))
  useEffect(() => { void load() }, [id])

  if (!incident) return error ? <p role="alert" class="text-sm text-red-600">{error}</p> : <p class="text-sm text-gray-400">{t('common.loading')}</p>
  const d = incident.data
  const c = countdown(incident)

  const act = async (fn: () => Promise<BreachIncident>) => {
    setError('')
    try { setIncident(await fn()) } catch (err) { setError(apiErrorMessage(err, t('incidents.error'))) }
  }
  const setStatus = (status: string) => act(() => apiFetch(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }))
  const milestone = (m: BreachMilestone) => act(() => apiFetch(`/incidents/${encodeURIComponent(id)}/milestones`, { method: 'POST', body: JSON.stringify({ milestone: m }) }))
  const draft = async (kind: BreachNoticeKind) => {
    setError('')
    try {
      setNotice(await apiFetch(`/incidents/${encodeURIComponent(id)}/notices`, { method: 'POST', body: JSON.stringify({ kind, locale: noticeLocale }) }))
      void load()
    } catch (err) { setError(apiErrorMessage(err, t('incidents.error'))) }
  }
  const download = () => {
    if (!notice) return
    const url = URL.createObjectURL(new Blob([notice.text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${incident.id}-${notice.kind}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div class="space-y-4">
      <a href="#/incidents" class="text-sm text-blue-600 hover:underline">← {t('incidents.back')}</a>
      {error && <p role="alert" class="text-sm text-red-600">{error}</p>}

      <div class={`${card} space-y-3`}>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{d.title}</h2>
            <p class="text-xs text-gray-500 font-mono">{incident.id}</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-gray-500">{t('incidents.col.reportDue')}: {fmt(incident.dueAt)}</p>
            <p role="timer" class={`text-lg ${TONE[c.tone]}`}>{c.text}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <label for="incident-status" class="text-xs font-medium text-gray-600">{t('common.status')}</label>
          <Select id="incident-status" disabled={!canEdit} options={STATUSES.map(s => ({ value: s, label: t(`incidents.status.${s}` as TranslationKey) }))} value={incident.status ?? 'open'} onChange={v => { void setStatus(v) }} />
          <span>{t('incidents.field.severity')}: {t(`incidents.severity.${d.severity}` as TranslationKey)}</span>
          {canEdit && !editing && <button class={btnGhost} onClick={() => setEditing(true)}>{t('common.edit')}</button>}
        </div>
      </div>

      {editing ? (
        <IncidentForm
          initial={d}
          submitLabel={t('common.save')}
          onCancel={() => setEditing(false)}
          onSubmit={async fields => {
            setIncident(await apiFetch(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) }))
            setEditing(false)
          }}
        />
      ) : (
        <div class={`${card} grid gap-3 sm:grid-cols-2 text-sm`}>
          {([
            ['discoveredAt', fmt(d.discoveredAt)], ['occurredAt', fmt(d.occurredAt)], ['containedAt', fmt(d.containedAt)],
            ['affectedCount', d.affectedCount ?? '—'], ['dataCategories', d.dataCategories.join(', ') || '—'], ['affectedRegions', d.affectedRegions.join(', ') || '—'],
            ['description', d.description], ['cause', d.cause || '—'], ['systems', d.systems || '—'], ['likelyImpact', d.likelyImpact || '—'],
            ['containment', d.containment || '—'], ['userSteps', d.userSteps || '—'],
            ['organisation', d.organisation || '—'], ['contactName', d.contactName || '—'], ['contactEmail', d.contactEmail || '—'],
          ] as [keyof BreachIncidentFields, string | number][]).map(([k, v]) => (
            <div key={k}>
              <p class="text-xs font-medium text-gray-500">{t(`incidents.field.${k}` as TranslationKey)}</p>
              <p class="whitespace-pre-wrap">{v}</p>
            </div>
          ))}
        </div>
      )}

      <div class={`${card} space-y-2`}>
        <h3 class="text-sm font-semibold">{t('incidents.milestones')}</h3>
        <p class="text-xs text-gray-500">{t('incidents.milestonesHint')}</p>
        <ul class="space-y-2 text-sm">
          {MILESTONES.map(ms => (
            <li key={ms} class="flex flex-wrap items-center gap-3">
              <span class="min-w-[16rem]">{t(`incidents.milestone.${ms}` as TranslationKey)}</span>
              {d[ms] ? <span class="text-green-700">{fmt(d[ms])}</span> : canEdit
                ? <button class={btnGhost} onClick={() => { void milestone(ms) }}>{t('incidents.markDone')}</button>
                : <span class="text-gray-400">—</span>}
            </li>
          ))}
        </ul>
      </div>

      <div class={`${card} space-y-3`}>
        <h3 class="text-sm font-semibold">{t('incidents.notices')}</h3>
        <p class="text-xs text-gray-500">{t('incidents.noticesHint')}</p>
        <div class="flex flex-wrap items-center gap-2">
          <label for="notice-locale" class="text-xs font-medium text-gray-600">{t('common.locale')}</label>
          <Select id="notice-locale" options={NOTICE_LOCALES.map(l => ({ value: l, label: l }))} value={noticeLocale} onChange={setNoticeLocale} />
          {NOTICES.map(k => <button key={k} class={btnGhost} onClick={() => { void draft(k) }}>{t(`incidents.notice.${k}` as TranslationKey)}</button>)}
        </div>
        {notice && (
          <div class="space-y-2">
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-500">{t('incidents.fromTemplate', { file: notice.template })}</span>
              <button class="text-sm text-blue-600 hover:underline" onClick={() => { void navigator.clipboard?.writeText(notice.text) }}>{t('incidents.copy')}</button>
              <button class="text-sm text-blue-600 hover:underline" onClick={download}>{t('incidents.download')}</button>
            </div>
            <pre class="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded p-3 max-h-[28rem] overflow-y-auto">{notice.text}</pre>
          </div>
        )}
      </div>

      <div class={`${card} space-y-2`}>
        <h3 class="text-sm font-semibold">{t('incidents.history')}</h3>
        <ol class="text-xs space-y-1">
          {[...d.history].reverse().map((h, i) => (
            <li key={i}>{fmt(h.at)} — {t(`incidents.action.${h.action}` as TranslationKey)}{h.detail ? `: ${h.detail}` : ''}{h.actorId ? ` (${h.actorId.slice(0, 8)})` : ''}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function IncidentForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: BreachIncidentFields
  submitLabel: string
  onSubmit: (fields: Partial<BreachIncidentFields>) => Promise<void>
  onCancel: () => void
}) {
  const t = useT()
  const [f, setF] = useState(() => ({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    discoveredAt: toLocalInput(initial?.discoveredAt ?? new Date().toISOString()),
    occurredAt: toLocalInput(initial?.occurredAt ?? null),
    containedAt: toLocalInput(initial?.containedAt ?? null),
    severity: initial?.severity ?? 'medium' as BreachSeverity,
    cause: initial?.cause ?? '',
    dataCategories: (initial?.dataCategories ?? []).join(', '),
    affectedCount: initial?.affectedCount != null ? String(initial.affectedCount) : '',
    affectedRegions: (initial?.affectedRegions ?? []).join(', '),
    systems: initial?.systems ?? '',
    likelyImpact: initial?.likelyImpact ?? '',
    containment: initial?.containment ?? '',
    userSteps: initial?.userSteps ?? '',
    organisation: initial?.organisation ?? '',
    contactName: initial?.contactName ?? '',
    contactEmail: initial?.contactEmail ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: Event) => setF(prev => ({ ...prev, [k]: (e.target as HTMLInputElement).value }))
  const list = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean)

  const submit = async (e: Event) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        title: f.title, description: f.description, severity: f.severity,
        discoveredAt: fromLocalInput(f.discoveredAt) ?? '', occurredAt: fromLocalInput(f.occurredAt), containedAt: fromLocalInput(f.containedAt),
        cause: f.cause, dataCategories: list(f.dataCategories), affectedRegions: list(f.affectedRegions),
        affectedCount: f.affectedCount.trim() ? Number(f.affectedCount) : null,
        systems: f.systems, likelyImpact: f.likelyImpact, containment: f.containment, userSteps: f.userSteps,
        organisation: f.organisation, contactName: f.contactName, contactEmail: f.contactEmail,
      })
    } catch (err) {
      setError(apiErrorMessage(err, t('incidents.error')))
    } finally {
      setSaving(false)
    }
  }

  const field = (k: keyof typeof f, opts: { type?: string; area?: boolean; required?: boolean; hint?: boolean; max?: number } = {}) => (
    <div class={opts.area ? 'sm:col-span-2' : ''}>
      <label for={`incident-${k}`} class="block text-xs font-medium text-gray-600 mb-1">
        {t(`incidents.field.${k}` as TranslationKey)}{opts.required && <span class="text-red-500" aria-hidden="true"> *</span>}
      </label>
      {opts.area
        ? <textarea id={`incident-${k}`} class={input} rows={3} maxLength={opts.max ?? 10000} required={opts.required} value={f[k]} onInput={set(k)} />
        : <input id={`incident-${k}`} type={opts.type ?? 'text'} class={input} maxLength={opts.max ?? 200} required={opts.required} value={f[k]} onInput={set(k)} />}
      {opts.hint && <p class="text-xs text-gray-500 mt-0.5">{t(`incidents.hint.${k}` as TranslationKey)}</p>}
    </div>
  )

  return (
    <form onSubmit={submit} class={`${card} grid gap-3 sm:grid-cols-2`}>
      {field('title', { required: true })}
      <div>
        <label for="incident-severity" class="block text-xs font-medium text-gray-600 mb-1">{t('incidents.field.severity')}<span class="text-red-500" aria-hidden="true"> *</span></label>
        <Select id="incident-severity" options={SEVERITIES.map(s => ({ value: s, label: t(`incidents.severity.${s}` as TranslationKey) }))} value={f.severity} onChange={v => setF(prev => ({ ...prev, severity: v as BreachSeverity }))} />
      </div>
      {field('discoveredAt', { type: 'datetime-local', required: true, hint: true })}
      {field('occurredAt', { type: 'datetime-local' })}
      {field('containedAt', { type: 'datetime-local' })}
      {field('affectedCount', { type: 'number' })}
      {field('description', { area: true, required: true })}
      {field('cause', { area: true })}
      {field('dataCategories', { hint: true, max: 2000 })}
      {field('affectedRegions', { hint: true, max: 500 })}
      {field('systems', { area: true, max: 2000 })}
      {field('likelyImpact', { area: true, max: 5000 })}
      {field('containment', { area: true })}
      {field('userSteps', { area: true, max: 5000 })}
      {field('organisation')}
      {field('contactName')}
      {field('contactEmail', { type: 'email', max: 254 })}
      <div class="sm:col-span-2 flex items-center gap-3">
        <button type="submit" class={btn} disabled={saving}>{saving ? t('common.saving') : submitLabel}</button>
        <button type="button" class={btnGhost} onClick={onCancel}>{t('common.cancel')}</button>
        {error && <span role="alert" class="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  )
}
