import { useEffect, useState } from 'preact/hooks'
import type { ErasureRequest, ErasureRequestStatus, ErasureRequestChannel, NoticeVersion, RetentionPolicy, RetentionRunResult } from '@consenti/types'
import { usePageTitle } from '../context/pageTitle'
import { useT } from '../context/locale'
import { useAuth } from '../context/auth'
import { DataTable } from '../components/DataTable'
import { RecordDetailModal } from '../components/RecordDetailModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Select } from '../components/Select'
import { apiDownload, apiErrorMessage } from '../api/client'
import { recordsApi, type ReceiptRow, type ErasureList } from '../api/records'
import type { TranslationKey } from '../utils/t'

type Tab = 'inbox' | 'receipts' | 'notices' | 'retention'
const TABS: Tab[] = ['inbox', 'receipts', 'notices', 'retention']
const STATUSES: ErasureRequestStatus[] = ['received', 'verifying', 'in_progress', 'completed', 'rejected']
const NEXT: Record<ErasureRequestStatus, ErasureRequestStatus[]> = {
  received: ['verifying', 'in_progress', 'completed', 'rejected'],
  verifying: ['in_progress', 'completed', 'rejected'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
}
const CHANNELS: ErasureRequestChannel[] = ['email', 'dashboard', 'widget', 'api', 'other']
const ACTIONS = ['given', 'updated', 'withdrawn', 'expired', 'erased'] as const

const btn = 'px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const input = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm'
const card = 'bg-white rounded-lg border border-gray-200 p-5'

function fmt(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—'
}

function tabFromHash(hash: string): Tab {
  const m = hash.match(/^#\/records\/(\w+)/)
  return (m && TABS.includes(m[1] as Tab) ? m[1] : 'inbox') as Tab
}

/** Ijazat records: deletion-request inbox, consent receipts, notice versions and retention. */
export function Records({ current }: { current: string }) {
  const t = useT()
  usePageTitle(t('records.title'))
  const tab = tabFromHash(current)
  return (
    <div class="space-y-4">
      <p class="text-xs text-amber-700">{t('records.notLegalAdvice')}</p>
      <div role="tablist" class="flex gap-1 border-b border-gray-200">
        {TABS.map(id => (
          <a
            key={id}
            role="tab"
            aria-selected={tab === id}
            href={`#/records/${id}`}
            class={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === id ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {t(`records.tab.${id}` as TranslationKey)}
          </a>
        ))}
      </div>
      {tab === 'inbox' && <Inbox />}
      {tab === 'receipts' && <Receipts />}
      {tab === 'notices' && <Notices />}
      {tab === 'retention' && <Retention />}
    </div>
  )
}

// ── Deletion-request inbox ─────────────────────────────────────────────────────

function Inbox() {
  const t = useT()
  const { user } = useAuth()
  const canEdit = !!user?.permissions.includes('settings:update')
  const [data, setData] = useState<ErasureList | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<ErasureRequest | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    recordsApi.erasureRequests({ page, limit: pageSize, ...(status ? { status } : {}) })
      .then(setData)
      .catch(err => setError(apiErrorMessage(err, t('records.error'))))
      .finally(() => setLoading(false))
  }
  useEffect(load, [page, pageSize, status])

  const now = data?.now ?? new Date().toISOString()
  const isOverdue = (r: ErasureRequest) => !!r.dueAt && r.dueAt < now && ['received', 'verifying', 'in_progress'].includes(r.status ?? '')

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <span>{t('records.inbox.open', { n: data?.open ?? 0 })}</span>
        <span class={data?.overdue ? 'text-red-700 font-medium' : ''}>{t('records.inbox.overdue', { n: data?.overdue ?? 0 })}</span>
        {canEdit && <button class={btnGhost} onClick={() => setShowNew(v => !v)} aria-expanded={showNew}>{t('records.inbox.new')}</button>}
      </div>
      {error && <p role="alert" class="text-sm text-red-600">{error}</p>}
      {showNew && <NewRequest onCreated={() => { setShowNew(false); setPage(1); load() }} />}

      <DataTable
        loading={loading}
        rows={(data?.items ?? []) as unknown as Record<string, unknown>[]}
        keyFn={r => (r as unknown as ErasureRequest).id}
        filters={
          <Select
            options={[{ value: '', label: t('records.inbox.allStatuses') }, ...STATUSES.map(s => ({ value: s, label: t(`records.status.${s}` as TranslationKey) }))]}
            value={status}
            onChange={v => { setStatus(v); setPage(1) }}
          />
        }
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={n => { setPageSize(n); setPage(1) }}
        toolbarEnd={<button onClick={() => { void apiDownload('/export/erasure-requests?format=csv') }} class="text-sm text-blue-600 hover:underline">{t('common.exportCsv')}</button>}
        columns={[
          { key: 'createdAt', label: t('records.col.received'), render: r => fmt((r as unknown as ErasureRequest).createdAt) },
          {
            key: 'dueAt', label: t('records.col.due'), render: r => {
              const req = r as unknown as ErasureRequest
              return <span class={isOverdue(req) ? 'text-red-700 font-medium' : ''}>{fmt(req.dueAt)}{isOverdue(req) ? ` · ${t('records.inbox.overdueTag')}` : ''}</span>
            },
          },
          { key: 'status', label: t('common.status'), render: r => t(`records.status.${(r as unknown as ErasureRequest).status}` as TranslationKey) },
          { key: 'channel', label: t('records.col.channel'), render: r => t(`records.channel.${(r as unknown as ErasureRequest).data.channel}` as TranslationKey) },
          { key: 'contact', label: t('records.col.contact'), render: r => (r as unknown as ErasureRequest).data.contact ?? '—' },
          {
            key: 'id', label: '', render: r => (
              <button class="text-xs text-blue-600 hover:underline" onClick={() => setSelected(r as unknown as ErasureRequest)}>{t('records.inbox.open.button')}</button>
            ),
          },
        ]}
        emptyText={t('records.inbox.empty')}
      />

      {selected && (
        <RequestDetail
          request={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={r => { setSelected(r); load() }}
        />
      )}
    </div>
  )
}

function NewRequest({ onCreated }: { onCreated: () => void }) {
  const t = useT()
  const [channel, setChannel] = useState<ErasureRequestChannel>('email')
  const [contact, setContact] = useState('')
  const [visitorId, setVisitorId] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: Event) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await recordsApi.createErasureRequest({
        channel, ...(contact ? { contact } : {}), ...(visitorId ? { visitorId } : {}), ...(message ? { message } : {}),
      })
      onCreated()
    } catch (err) {
      setError(apiErrorMessage(err, t('records.error')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} class={`${card} grid gap-3 sm:grid-cols-2`}>
      <div>
        <label for="erq-channel" class="block text-xs font-medium text-gray-600 mb-1">{t('records.col.channel')}</label>
        <Select id="erq-channel" options={CHANNELS.map(c => ({ value: c, label: t(`records.channel.${c}` as TranslationKey) }))} value={channel} onChange={v => setChannel(v as ErasureRequestChannel)} />
      </div>
      <div>
        <label for="erq-contact" class="block text-xs font-medium text-gray-600 mb-1">{t('records.col.contact')}</label>
        <input id="erq-contact" class={input} value={contact} maxLength={254} onInput={e => setContact((e.target as HTMLInputElement).value)} />
      </div>
      <div>
        <label for="erq-visitor" class="block text-xs font-medium text-gray-600 mb-1">{t('records.visitorId')}</label>
        <input id="erq-visitor" class={`${input} font-mono`} value={visitorId} maxLength={200} onInput={e => setVisitorId((e.target as HTMLInputElement).value)} />
      </div>
      <div class="sm:col-span-2">
        <label for="erq-message" class="block text-xs font-medium text-gray-600 mb-1">{t('records.message')}</label>
        <textarea id="erq-message" class={input} rows={3} maxLength={2000} value={message} onInput={e => setMessage((e.target as HTMLTextAreaElement).value)} />
      </div>
      <p class="sm:col-span-2 text-xs text-gray-500">{t('records.inbox.newHint')}</p>
      <div class="sm:col-span-2 flex items-center gap-3">
        <button type="submit" class={btn} disabled={saving || (!contact && !visitorId)}>{saving ? t('common.saving') : t('common.create')}</button>
        {error && <span role="alert" class="text-xs text-red-600">{error}</span>}
      </div>
    </form>
  )
}

function RequestDetail({ request, canEdit, onClose, onChanged }: {
  request: ErasureRequest; canEdit: boolean; onClose: () => void; onChanged: (r: ErasureRequest) => void
}) {
  const t = useT()
  const options = NEXT[(request.status ?? 'received') as ErasureRequestStatus]
  const [next, setNext] = useState<ErasureRequestStatus | ''>(options[0] ?? '')
  const [note, setNote] = useState('')
  const [eraseConsent, setEraseConsent] = useState(!!request.data.visitorId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const apply = async () => {
    if (!next) return
    setSaving(true)
    setError('')
    try {
      const updated = await recordsApi.updateErasureRequest(request.id, {
        status: next, ...(note ? { note } : {}), ...(next === 'completed' ? { eraseConsent } : {}),
      })
      setNote('')
      onChanged(updated)
    } catch (err) {
      setError(apiErrorMessage(err, t('records.error')))
    } finally {
      setSaving(false)
      setConfirming(false)
    }
  }

  const controls = canEdit && options.length > 0 ? (
    <div class="space-y-2">
      <Select options={options.map(s => ({ value: s, label: t(`records.status.${s}` as TranslationKey) }))} value={next} onChange={v => setNext(v as ErasureRequestStatus)} />
      <textarea aria-label={t('records.note')} placeholder={t('records.note')} class={input} rows={2} maxLength={2000} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
      {next === 'completed' && request.data.visitorId && (
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={eraseConsent} onChange={e => setEraseConsent((e.target as HTMLInputElement).checked)} />
          {t('records.inbox.eraseConsent')}
        </label>
      )}
      <button class={btn} disabled={saving || !next || (next === 'rejected' && !note.trim())} onClick={() => (next === 'completed' && eraseConsent ? setConfirming(true) : void apply())}>
        {saving ? t('common.saving') : t('records.inbox.apply')}
      </button>
      {error && <p role="alert" class="text-xs text-red-600">{error}</p>}
    </div>
  ) : null

  return (
    <>
      <RecordDetailModal
        open
        title={t('records.inbox.detail')}
        onClose={onClose}
        fields={[
          { label: t('common.status'), value: t(`records.status.${request.status}` as TranslationKey) },
          { label: t('records.col.received'), value: fmt(request.createdAt) },
          { label: t('records.col.due'), value: fmt(request.dueAt) },
          { label: t('records.col.channel'), value: t(`records.channel.${request.data.channel}` as TranslationKey) },
          { label: t('records.col.contact'), value: request.data.contact ?? '—' },
          { label: t('records.visitorId'), value: request.data.visitorId ? <span class="font-mono text-xs">{request.data.visitorId}</span> : '—' },
          { label: t('records.message'), value: request.data.message ? <span class="whitespace-pre-wrap">{request.data.message}</span> : '—' },
          { label: t('records.inbox.consentErased'), value: request.data.consentErased ? t('records.yes') : t('records.no') },
          {
            label: t('records.inbox.history'), value: (
              <ol class="text-xs space-y-1">
                {request.data.history.map((h, i) => (
                  <li key={i}>{fmt(h.at)} — {t(`records.status.${h.status}` as TranslationKey)}{h.actorId ? ` (${h.actorId.slice(0, 8)})` : ''}{h.note ? `: ${h.note}` : ''}</li>
                ))}
              </ol>
            ),
          },
          ...(controls ? [{ label: t('records.inbox.change'), value: controls }] : []),
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title={t('records.inbox.confirmTitle')}
        message={t('records.inbox.confirmText')}
        danger
        onConfirm={() => { void apply() }}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

// ── Receipts ───────────────────────────────────────────────────────────────────

function Receipts() {
  const t = useT()
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [visitorId, setVisitorId] = useState('')
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ReceiptRow | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true)
      recordsApi.receipts({ page, limit: pageSize, ...(visitorId.trim() ? { visitorId: visitorId.trim() } : {}), ...(action ? { action } : {}) })
        .then(r => { setRows(r.items); setTotal(r.total) })
        .catch(() => { })
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [page, pageSize, visitorId, action])

  const on = (r: ReceiptRow) => Object.entries(r.data.purposes).filter(([, s]) => s !== 'denied').map(([p, s]) => s === 'partial' ? `${p} (${t('records.partial')})` : p)

  return (
    <>
      <p class="text-xs text-gray-500">{t('records.receipts.hint')}</p>
      <DataTable
        loading={loading}
        rows={rows as unknown as Record<string, unknown>[]}
        keyFn={r => (r as unknown as ReceiptRow).id}
        searchValue={visitorId}
        onSearchChange={v => { setVisitorId(v); setPage(1) }}
        searchPlaceholder={t('records.receipts.search')}
        filters={
          <Select
            options={[{ value: '', label: t('records.receipts.allActions') }, ...ACTIONS.map(a => ({ value: a, label: t(`records.action.${a}` as TranslationKey) }))]}
            value={action}
            onChange={v => { setAction(v); setPage(1) }}
          />
        }
        total={total}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={n => { setPageSize(n); setPage(1) }}
        toolbarEnd={
          <span class="flex gap-3">
            <button onClick={() => { void apiDownload('/export/receipts?format=csv') }} class="text-sm text-blue-600 hover:underline">{t('common.exportCsv')}</button>
            <button onClick={() => { void apiDownload('/export/receipts?format=json') }} class="text-sm text-blue-600 hover:underline">{t('records.exportJson')}</button>
          </span>
        }
        columns={[
          { key: 'createdAt', label: t('records.col.time'), render: r => fmt((r as unknown as ReceiptRow).createdAt) },
          { key: 'status', label: t('records.col.action'), render: r => t(`records.action.${(r as unknown as ReceiptRow).data.action}` as TranslationKey) },
          { key: 'purposes', label: t('records.col.purposesOn'), render: r => on(r as unknown as ReceiptRow).join(', ') || '—' },
          { key: 'notice', label: t('records.col.noticeVersion'), render: r => (r as unknown as ReceiptRow).data.noticeVersion ?? '—' },
          { key: 'locale', label: t('common.locale'), render: r => (r as unknown as ReceiptRow).data.locale ?? '—' },
          {
            key: 'verified', label: t('records.col.signature'), render: r => (r as unknown as ReceiptRow).verified
              ? <span class="text-green-700">{t('records.verified')}</span>
              : <span class="text-red-700 font-medium">{t('records.notVerified')}</span>,
          },
          { key: 'id', label: '', render: r => <button class="text-xs text-blue-600 hover:underline" onClick={() => setSelected(r as unknown as ReceiptRow)}>{t('records.view')}</button> },
        ]}
        emptyText={t('records.receipts.empty')}
      />
      {selected && (
        <RecordDetailModal
          open
          title={t('records.receipts.detail')}
          onClose={() => setSelected(null)}
          fields={[
            { label: t('records.col.time'), value: fmt(selected.createdAt) },
            { label: t('records.col.action'), value: t(`records.action.${selected.data.action}` as TranslationKey) },
            { label: t('records.visitorRef'), value: <span class="font-mono text-xs break-all">{selected.ref}</span> },
            { label: t('records.profile'), value: <span class="font-mono text-xs">{selected.data.profileId ?? '—'} v{selected.data.profileVersion ?? '?'}</span> },
            { label: t('records.col.noticeVersion'), value: selected.data.noticeVersion ?? '—' },
            { label: t('common.locale'), value: selected.data.locale ?? '—' },
            { label: t('records.purposes'), value: <pre class="text-xs whitespace-pre-wrap">{JSON.stringify(selected.data.purposes, null, 2)}</pre> },
            ...(selected.data.expiredPurposes?.length ? [{ label: t('records.expiredPurposes'), value: selected.data.expiredPurposes.join(', ') }] : []),
            { label: t('records.col.signature'), value: selected.verified ? t('records.verified') : t('records.notVerified') },
          ]}
        />
      )}
    </>
  )
}

// ── Notice versions ────────────────────────────────────────────────────────────

function Notices() {
  const t = useT()
  const [rows, setRows] = useState<NoticeVersion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    recordsApi.noticeVersions({ page, limit: pageSize })
      .then(r => { setRows(r.items); setTotal(r.total) })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [page, pageSize])

  return (
    <>
      <p class="text-xs text-gray-500">{t('records.notices.hint')}</p>
      <DataTable
        loading={loading}
        rows={rows as unknown as Record<string, unknown>[]}
        keyFn={r => (r as unknown as NoticeVersion).id}
        total={total}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={n => { setPageSize(n); setPage(1) }}
        toolbarEnd={<button onClick={() => { void apiDownload('/export/notice-versions?format=csv') }} class="text-sm text-blue-600 hover:underline">{t('common.exportCsv')}</button>}
        columns={[
          { key: 'createdAt', label: t('records.col.time'), render: r => fmt((r as unknown as NoticeVersion).createdAt) },
          {
            key: 'profile', label: t('records.profile'), render: r => {
              const n = r as unknown as NoticeVersion
              return <a class="text-blue-600 hover:underline" href={`#/banners/profiles/${n.data.profileId}/history?version=${n.data.profileVersion}`}>{n.data.profileName} v{n.data.profileVersion}</a>
            },
          },
          { key: 'notice', label: t('records.col.noticeVersion'), render: r => (r as unknown as NoticeVersion).data.noticeVersion ?? '—' },
          {
            key: 'review', label: t('records.col.review'), render: r => {
              const s = (r as unknown as NoticeVersion).data.noticeStatus
              return s === 'reviewed' ? t('records.reviewed') : s === 'draft' ? <span class="text-amber-700">{t('records.draft')}</span> : '—'
            },
          },
          { key: 'hash', label: t('records.col.hash'), render: r => <span class="font-mono text-xs">{(r as unknown as NoticeVersion).data.contentHash.slice(0, 12)}</span> },
        ]}
        emptyText={t('records.notices.empty')}
      />
    </>
  )
}

// ── Retention ──────────────────────────────────────────────────────────────────

function parsePurposes(text: string): Record<string, number> | string {
  const out: Record<string, number> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z0-9_-]+)\s*[:=]\s*(\d+)$/)
    if (!m) return line
    out[m[1]!] = Number(m[2])
  }
  return out
}

function Retention() {
  const t = useT()
  const { user } = useAuth()
  const canEdit = !!user?.permissions.includes('settings:update')
  const [purposes, setPurposes] = useState('')
  const [receiptDays, setReceiptDays] = useState('')
  const [closedDays, setClosedDays] = useState('')
  const [responseDays, setResponseDays] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [result, setResult] = useState<RetentionRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRun, setConfirmRun] = useState(false)

  useEffect(() => {
    recordsApi.policy().then(p => {
      setPurposes(Object.entries(p.purposeExpiryDays ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'))
      setReceiptDays(p.receiptDays ? String(p.receiptDays) : '')
      setClosedDays(p.closedErasureRequestDays ? String(p.closedErasureRequestDays) : '')
      setResponseDays(p.erasureResponseDays ? String(p.erasureResponseDays) : '')
    }).catch(err => setStatus({ ok: false, text: apiErrorMessage(err, t('records.error')) }))
  }, [])

  const save = async () => {
    const parsed = parsePurposes(purposes)
    if (typeof parsed === 'string') { setStatus({ ok: false, text: t('records.retention.badLine', { line: parsed }) }); return }
    const num = (s: string) => (s.trim() ? Number(s) : undefined)
    const policy: RetentionPolicy = {
      ...(Object.keys(parsed).length ? { purposeExpiryDays: parsed } : {}),
      ...(num(receiptDays) !== undefined ? { receiptDays: num(receiptDays)! } : {}),
      ...(num(closedDays) !== undefined ? { closedErasureRequestDays: num(closedDays)! } : {}),
      ...(num(responseDays) !== undefined ? { erasureResponseDays: num(responseDays)! } : {}),
    }
    setBusy(true)
    try {
      await recordsApi.savePolicy(policy)
      setStatus({ ok: true, text: t('records.retention.saved') })
    } catch (err) {
      setStatus({ ok: false, text: apiErrorMessage(err, t('records.error')) })
    } finally {
      setBusy(false)
    }
  }

  const run = async (dryRun: boolean) => {
    setBusy(true)
    setConfirmRun(false)
    try {
      setResult(await recordsApi.runRetention(dryRun))
    } catch (err) {
      setStatus({ ok: false, text: apiErrorMessage(err, t('records.error')) })
    } finally {
      setBusy(false)
    }
  }

  const days = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label for={id} class="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input id={id} type="number" min={1} max={36500} class={input} value={value} disabled={!canEdit} onInput={e => set((e.target as HTMLInputElement).value)} placeholder={t('records.retention.keep')} />
    </div>
  )

  return (
    <div class={`${card} space-y-4 max-w-2xl`}>
      <p class="text-xs text-gray-500">{t('records.retention.hint')}</p>
      <div>
        <label for="ret-purposes" class="block text-xs font-medium text-gray-600 mb-1">{t('records.retention.purposes')}</label>
        <textarea id="ret-purposes" class={`${input} font-mono`} rows={4} value={purposes} disabled={!canEdit} placeholder={'analytics: 365\nmarketing: 180'} onInput={e => setPurposes((e.target as HTMLTextAreaElement).value)} />
        <p class="text-xs text-gray-500 mt-1">{t('records.retention.purposesHint')}</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        {days('ret-receipts', t('records.retention.receiptDays'), receiptDays, setReceiptDays)}
        {days('ret-closed', t('records.retention.closedDays'), closedDays, setClosedDays)}
        {days('ret-response', t('records.retention.responseDays'), responseDays, setResponseDays)}
      </div>
      {canEdit && (
        <div class="flex flex-wrap items-center gap-3">
          <button class={btn} disabled={busy} onClick={() => { void save() }}>{t('common.save')}</button>
          <button class={btnGhost} disabled={busy} onClick={() => { void run(true) }}>{t('records.retention.preview')}</button>
          <button class={btnGhost} disabled={busy} onClick={() => setConfirmRun(true)}>{t('records.retention.runNow')}</button>
          {status && <span role="status" class={`text-xs ${status.ok ? 'text-green-700' : 'text-red-600'}`}>{status.text}</span>}
        </div>
      )}
      {result && (
        <div role="status" class="text-sm bg-gray-50 border border-gray-200 rounded p-3">
          <p class="font-medium">{result.dryRun ? t('records.retention.previewResult') : t('records.retention.runResult')}</p>
          <p>{t('records.retention.summary', { visitors: result.expired.length, receipts: result.receiptsDeleted, requests: result.erasureRequestsDeleted })}</p>
        </div>
      )}
      <ConfirmDialog
        open={confirmRun}
        title={t('records.retention.runNow')}
        message={t('records.retention.confirmText')}
        danger
        onConfirm={() => { void run(false) }}
        onCancel={() => setConfirmRun(false)}
      />
    </div>
  )
}
