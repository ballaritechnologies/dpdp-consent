/**
 * Ijazat record-keeping (admin API): consent receipts, notice version history, the deletion-request
 * inbox, purpose-based retention, and CSV/JSON export of all of them. `?tenantId=` selects the
 * tenant, subject to the caller's `allowedTenants`; omitted, it is `'default'`.
 *
 * Permissions: reading needs `consent:view`; changing requests, the retention policy and running
 * retention need `settings:update`; exports need `export:run`.
 */
import type {
  StorageAdapter, AuthConfig, EntityFilter, ServerConsentReceipt, ErasureRequest, NoticeVersion,
  ErasureRequestStatus, ErasureRequestChannel, ConsentReceiptAction,
} from '@consenti/types'
import { withErrorHandler, errorResponse } from '../../middleware/error.middleware'
import { authenticate, authError, type AuthenticatedUser } from '../../middleware/auth.middleware'
import { getPagination, parseJsonBody, json } from '../../utils/http'
import type { ReceiptService } from '../../services/receipt.service'
import type { NoticeVersionService } from '../../services/notice-version.service'
import {
  ErasureRequestError, ERASURE_STATUSES, ERASURE_CHANNELS, OPEN_ERASURE_STATUSES,
  type ErasureRequestService,
} from '../../services/erasure-request.service'
import { RetentionPolicyError, type RetentionService } from '../../services/retention.service'

const RECEIPT_ACTIONS: readonly ConsentReceiptAction[] = ['given', 'updated', 'withdrawn', 'expired', 'erased']
const EXPORT_PAGE = 1000

export interface RecordServices {
  receipts: ReceiptService
  noticeVersions: NoticeVersionService
  erasure: ErasureRequestService
  retention: RetentionService
}

function isoParam(url: URL, key: string): string | undefined | Response {
  const v = url.searchParams.get(key)
  if (!v) return undefined
  const t = Date.parse(v)
  if (Number.isNaN(t)) return errorResponse(400, `${key} must be an ISO date`)
  return new Date(t).toISOString()
}

function csvCell(val: unknown): string {
  const s = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
  // Leading = + - @ would run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n'
}

export function buildAdminRecordRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
  services: RecordServices,
) {
  const { receipts, noticeVersions, erasure, retention } = services

  async function guard(req: Request, permission: string): Promise<{ user: AuthenticatedUser; tenantId: string } | Response> {
    const user = await authenticate(req, storage, authConfig, secret)
    const denied = authError(user, permission)
    if (denied || !user) return denied ?? errorResponse(401, 'Unauthorized')
    const tenantId = new URL(req.url).searchParams.get('tenantId') || 'default'
    if (user.allowedTenants.length > 0 && !user.allowedTenants.includes(tenantId)) {
      return errorResponse(403, 'Not allowed for this tenant')
    }
    if (tenantId !== 'default' && !(await storage.getTenants()).some(t => t.id === tenantId)) {
      return errorResponse(404, 'Tenant not found')
    }
    return { user, tenantId }
  }

  function receiptFilter(url: URL, tenantId: string): EntityFilter | Response {
    const from = isoParam(url, 'from'); if (from instanceof Response) return from
    const to = isoParam(url, 'to'); if (to instanceof Response) return to
    const visitorId = url.searchParams.get('visitorId')
    const action = url.searchParams.get('action')
    if (action && !RECEIPT_ACTIONS.includes(action as ConsentReceiptAction)) return errorResponse(400, 'Unknown action')
    return {
      tenantId, collection: 'consent_receipt',
      ...(visitorId ? { ref: receipts.visitorRef(visitorId) } : {}),
      ...(action ? { status: action } : {}),
      ...(from ? { createdFrom: from } : {}),
      ...(to ? { createdBefore: to } : {}),
    }
  }

  function erasureFilter(url: URL, tenantId: string): EntityFilter | Response {
    const status = url.searchParams.get('status')
    if (status && !ERASURE_STATUSES.includes(status as ErasureRequestStatus)) return errorResponse(400, 'Unknown status')
    return { tenantId, collection: 'erasure_request', ...(status ? { status } : {}) }
  }

  function erasureError(err: unknown): Response {
    if (err instanceof ErasureRequestError) return errorResponse(err.status, err.message)
    throw err
  }

  /** Streams every matching record, page by page, as CSV or one JSON array. */
  function exportResponse<T>(
    format: string, name: string, header: string[], toRow: (r: T) => unknown[],
    page: (offset: number) => Promise<T[]>,
  ): Response {
    const enc = new TextEncoder()
    const isJson = format === 'json'
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(enc.encode(isJson ? '[' : csvRow(header)))
          let offset = 0
          let first = true
          for (;;) {
            const rows = await page(offset)
            for (const r of rows) {
              controller.enqueue(enc.encode(isJson ? `${first ? '' : ','}${JSON.stringify(r)}` : csvRow(toRow(r))))
              first = false
            }
            if (rows.length < EXPORT_PAGE) break
            offset += rows.length
          }
          if (isJson) controller.enqueue(enc.encode(']'))
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': isJson ? 'application/json' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}.${isJson ? 'json' : 'csv'}"`,
      },
    })
  }

  function exportFormat(url: URL): string | Response {
    const f = url.searchParams.get('format') ?? 'csv'
    return f === 'csv' || f === 'json' ? f : errorResponse(400, 'format must be csv or json')
  }

  return {
    // ── Consent receipts ───────────────────────────────────────────────────────
    'GET /receipts': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const p = getPagination(url); if ('error' in p) return errorResponse(400, p.error)
        const filter = receiptFilter(url, g.tenantId); if (filter instanceof Response) return filter
        const [items, total] = await Promise.all([
          receipts.list(filter, { limit: p.limit, offset: (p.page - 1) * p.limit }),
          receipts.count(filter),
        ])
        return json(200, { items: items.map(r => ({ ...r, verified: receipts.verify(r) })), total, page: p.page, limit: p.limit })
      }),

    // ── Notice versions ────────────────────────────────────────────────────────
    'GET /notice-versions': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const p = getPagination(url); if ('error' in p) return errorResponse(400, p.error)
        const profileId = url.searchParams.get('profileId') ?? undefined
        const [items, total] = await Promise.all([
          noticeVersions.list(g.tenantId, profileId, { limit: p.limit, offset: (p.page - 1) * p.limit }),
          noticeVersions.count(g.tenantId, profileId),
        ])
        return json(200, { items, total, page: p.page, limit: p.limit })
      }),

    // ── Erasure requests ───────────────────────────────────────────────────────
    'GET /erasure-requests': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const now = new Date()
        if (url.searchParams.get('overdue') === '1') {
          const items = await erasure.overdue(g.tenantId, now)
          return json(200, { items, total: items.length, page: 1, limit: items.length, now: now.toISOString() })
        }
        const p = getPagination(url); if ('error' in p) return errorResponse(400, p.error)
        const filter = erasureFilter(url, g.tenantId); if (filter instanceof Response) return filter
        const [items, total, open, overdue] = await Promise.all([
          erasure.list(filter, { limit: p.limit, offset: (p.page - 1) * p.limit }),
          erasure.count(filter),
          Promise.all(OPEN_ERASURE_STATUSES.map(status => erasure.count({ tenantId: g.tenantId, status }))).then(n => n.reduce((a, b) => a + b, 0)),
          erasure.overdue(g.tenantId, now).then(r => r.length),
        ])
        return json(200, { items, total, page: p.page, limit: p.limit, open, overdue, now: now.toISOString() })
      }),

    'POST /erasure-requests': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const body = await parseJsonBody<Record<string, unknown>>(req)
        if (!body || typeof body !== 'object') return errorResponse(400, 'Invalid JSON body')
        const channel = (body['channel'] ?? 'dashboard') as ErasureRequestChannel
        if (!ERASURE_CHANNELS.includes(channel)) return errorResponse(400, 'Invalid channel')
        try {
          const created = await erasure.create({
            tenantId: g.tenantId, channel, actorId: g.user.sub,
            visitorId: body['visitorId'] as string | null, contact: body['contact'] as string | null, message: body['message'] as string | null,
          })
          return json(201, created)
        } catch (err) { return erasureError(err) }
      }),

    'GET /erasure-requests/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const r = await erasure.get(g.tenantId, params['id'] ?? '')
        return r ? json(200, r) : errorResponse(404, 'Erasure request not found')
      }),

    'PATCH /erasure-requests/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const body = await parseJsonBody<Record<string, unknown>>(req)
        if (!body || typeof body !== 'object') return errorResponse(400, 'Invalid JSON body')
        if (body['eraseConsent'] !== undefined && typeof body['eraseConsent'] !== 'boolean') return errorResponse(400, 'eraseConsent must be a boolean')
        try {
          const updated = await erasure.transition(g.tenantId, params['id'] ?? '', {
            status: body['status'] as ErasureRequestStatus, note: body['note'] as string | null,
            actorId: g.user.sub, eraseConsent: body['eraseConsent'] === true,
          })
          return json(200, updated)
        } catch (err) { return erasureError(err) }
      }),

    // ── Retention ──────────────────────────────────────────────────────────────
    'GET /retention/policy': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        return json(200, await retention.getPolicy(g.tenantId))
      }),

    'PUT /retention/policy': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const body = await parseJsonBody(req)
        try {
          return json(200, await retention.setPolicy(g.tenantId, body, g.user.sub))
        } catch (err) {
          if (err instanceof RetentionPolicyError) return errorResponse(400, err.message)
          throw err
        }
      }),

    'POST /retention/run': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const body = await parseJsonBody<Record<string, unknown>>(req) ?? {}
        const dryRun = body['dryRun'] !== false
        return json(200, await retention.run(g.tenantId, { dryRun, actorId: g.user.sub }))
      }),

    // ── Exports ────────────────────────────────────────────────────────────────
    'GET /export/receipts': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'export:run'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const format = exportFormat(url); if (format instanceof Response) return format
        const filter = receiptFilter(url, g.tenantId); if (filter instanceof Response) return filter
        return exportResponse<ServerConsentReceipt>(format, 'consent-receipts',
          ['id', 'created_at', 'visitor_ref', 'action', 'profile_id', 'profile_version', 'notice_version', 'compliance_group', 'locale', 'source', 'gpc_detected', 'purposes', 'consent', 'expired_purposes', 'signature', 'verified'],
          r => [r.id, r.createdAt, r.ref, r.data.action, r.data.profileId, r.data.profileVersion, r.data.noticeVersion, r.data.complianceGroup, r.data.locale, r.data.source, r.data.gpcDetected ? 1 : 0, r.data.purposes, r.data.consent, r.data.expiredPurposes ?? [], r.data.signature, receipts.verify(r) ? 1 : 0],
          offset => receipts.list(filter, { order: 'asc', limit: EXPORT_PAGE, offset }))
      }),

    'GET /export/erasure-requests': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'export:run'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const format = exportFormat(url); if (format instanceof Response) return format
        const filter = erasureFilter(url, g.tenantId); if (filter instanceof Response) return filter
        return exportResponse<ErasureRequest>(format, 'erasure-requests',
          ['id', 'created_at', 'updated_at', 'status', 'due_at', 'channel', 'visitor_ref', 'contact', 'message', 'consent_erased', 'history'],
          r => [r.id, r.createdAt, r.updatedAt, r.status, r.dueAt, r.data.channel, r.ref, r.data.contact, r.data.message, r.data.consentErased ? 1 : 0, r.data.history],
          offset => erasure.list(filter, { order: 'asc', limit: EXPORT_PAGE, offset }))
      }),

    'GET /export/notice-versions': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'export:run'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const format = exportFormat(url); if (format instanceof Response) return format
        const profileId = url.searchParams.get('profileId') ?? undefined
        return exportResponse<NoticeVersion>(format, 'notice-versions',
          ['id', 'created_at', 'profile_id', 'profile_name', 'profile_version', 'notice_version', 'notice_status', 'compliance_group', 'default_locale', 'content_hash', 'change', 'actor_id'],
          r => [r.id, r.createdAt, r.data.profileId, r.data.profileName, r.data.profileVersion, r.data.noticeVersion, r.data.noticeStatus, r.data.complianceGroup, r.data.defaultLocale, r.data.contentHash, r.data.change, r.data.actorId],
          offset => noticeVersions.list(g.tenantId, profileId, { order: 'asc', limit: EXPORT_PAGE, offset }))
      }),
  }
}
