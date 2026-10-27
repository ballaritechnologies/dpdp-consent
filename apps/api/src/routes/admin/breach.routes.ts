/**
 * Personal data breach incidents (admin API). `?tenantId=` selects the tenant, subject to the
 * caller's `allowedTenants`. Reading needs `audit:view`; changing needs `settings:update`;
 * export needs `export:run`.
 */
import type { StorageAdapter, AuthConfig, BreachIncident, BreachStatus, BreachMilestone, BreachNoticeKind } from '@consenti/types'
import { withErrorHandler, errorResponse } from '../../middleware/error.middleware'
import { getPagination, parseJsonBody, json } from '../../utils/http'
import { BreachError, BREACH_STATUSES, type BreachService } from '../../services/breach.service'
import { tenantGuard, exportResponse, exportFormat, EXPORT_PAGE } from './route-helpers'

export function buildAdminBreachRoutes(storage: StorageAdapter, authConfig: AuthConfig, secret: string, breaches: BreachService) {
  const guard = tenantGuard(storage, authConfig, secret)

  function statusParam(url: URL): BreachStatus | undefined | Response {
    const status = url.searchParams.get('status')
    if (!status) return undefined
    return BREACH_STATUSES.includes(status as BreachStatus) ? status as BreachStatus : errorResponse(400, 'Unknown status')
  }

  async function handle(fn: () => Promise<Response>): Promise<Response> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof BreachError) return errorResponse(err.status, err.message)
      throw err
    }
  }

  async function body(req: Request): Promise<Record<string, unknown> | Response> {
    const b = await parseJsonBody<Record<string, unknown>>(req)
    return b && typeof b === 'object' && !Array.isArray(b) ? b : errorResponse(400, 'Invalid JSON body')
  }

  return {
    'GET /incidents': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'audit:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const p = getPagination(url); if ('error' in p) return errorResponse(400, p.error)
        const status = statusParam(url); if (status instanceof Response) return status
        const { items, total } = await breaches.list(g.tenantId, status, { limit: p.limit, offset: (p.page - 1) * p.limit })
        return json(200, { items, total, page: p.page, limit: p.limit, now: new Date().toISOString() })
      }),

    'POST /incidents': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const b = await body(req); if (b instanceof Response) return b
        return handle(async () => json(201, await breaches.create(g.tenantId, b, g.user.sub)))
      }),

    'GET /incidents/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'audit:view'); if (g instanceof Response) return g
        const incident = await breaches.get(g.tenantId, params['id'] ?? '')
        return incident ? json(200, { ...incident, now: new Date().toISOString() }) : errorResponse(404, 'Incident not found')
      }),

    'PATCH /incidents/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const b = await body(req); if (b instanceof Response) return b
        return handle(async () => json(200, await breaches.update(g.tenantId, params['id'] ?? '', b, g.user.sub)))
      }),

    'POST /incidents/:id/milestones': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const b = await body(req); if (b instanceof Response) return b
        const at = b['at'] === undefined || b['at'] === null ? null : b['at']
        if (at !== null && typeof at !== 'string') return errorResponse(400, 'at must be an ISO date')
        return handle(async () => json(200, await breaches.markMilestone(g.tenantId, params['id'] ?? '', b['milestone'] as BreachMilestone, at, g.user.sub)))
      }),

    'POST /incidents/:id/notices': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'audit:view'); if (g instanceof Response) return g
        const b = await body(req); if (b instanceof Response) return b
        const locale = typeof b['locale'] === 'string' ? b['locale'] : 'en'
        return handle(async () => json(200, await breaches.draftNotice(g.tenantId, params['id'] ?? '', b['kind'] as BreachNoticeKind, locale, g.user.sub)))
      }),

    'GET /export/incidents': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'export:run'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const format = exportFormat(url); if (format instanceof Response) return format
        const status = statusParam(url); if (status instanceof Response) return status
        return exportResponse<BreachIncident>(format, 'breach-incidents',
          ['id', 'created_at', 'status', 'severity', 'title', 'discovered_at', 'report_due_at', 'board_intimated_at', 'board_report_sent_at', 'users_notified_at', 'closed_at', 'affected_count', 'data_categories', 'affected_regions', 'history'],
          r => [r.id, r.createdAt, r.status, r.data.severity, r.data.title, r.data.discoveredAt, r.dueAt, r.data.boardIntimatedAt, r.data.boardReportSentAt, r.data.usersNotifiedAt, r.data.closedAt, r.data.affectedCount, r.data.dataCategories, r.data.affectedRegions, r.data.history],
          async offset => (await breaches.list(g.tenantId, status, { order: 'asc', limit: EXPORT_PAGE, offset })).items)
      }),
  }
}
