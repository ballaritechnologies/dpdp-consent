import type { StorageAdapter, AuthConfig, AuditFilters } from '@consenti/types'
import { json, getQueryParam, getPagination } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'

export function buildAdminAuditRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
) {
  const guard = tenantGuard(storage, authConfig, secret)

  return {
    'GET /audit': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'audit:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const action = getQueryParam(url, 'action')
        const resourceType = getQueryParam(url, 'resourceType')
        const from = getQueryParam(url, 'from')
        const to = getQueryParam(url, 'to')
        const q = getQueryParam(url, 'q')
        const pagination = getPagination(url)
        if ('error' in pagination) return errorResponse(400, pagination.error)
        const { page, limit } = pagination
        const filters: AuditFilters = {
          tenantId: g.tenantId,
          page,
          limit,
          ...(action !== undefined ? { action } : {}),
          ...(resourceType !== undefined ? { resourceType } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          ...(q !== undefined ? { q } : {}),
        }
        const logs = await storage.getLogs(filters)
        return json(200, logs)
      }),

    'GET /audit/:id': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'audit:view'); if (g instanceof Response) return g
        const log = await storage.getAuditLogById(p['id'] ?? '')
        if (!log || log.tenantId !== g.tenantId) return errorResponse(404, 'Audit log entry not found')
        return json(200, log)
      }),
  }
}
