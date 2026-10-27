import type { StorageAdapter, AuthConfig, VisitorFilters } from '@consenti/types'
import { json, getQueryParam, getPagination } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'

/** See NOTICE_SHOWN_ENABLED in routes/public/notice.routes.ts — same dormant feature, kept for future reference. */
const NOTICE_SHOWN_ENABLED: boolean = false

export function buildAdminVisitorRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
) {
  const guard = tenantGuard(storage, authConfig, secret)

  return {
    'GET /visitors': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'visitor:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const from = getQueryParam(url, 'from')
        const to = getQueryParam(url, 'to')
        const q = getQueryParam(url, 'q')
        const pagination = getPagination(url)
        if ('error' in pagination) return errorResponse(400, pagination.error)
        const { page, limit } = pagination
        const filters: VisitorFilters = {
          tenantId: g.tenantId,
          page,
          limit,
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          ...(q !== undefined ? { q } : {}),
        }
        const visitors = await storage.getVisitors(filters)
        return json(200, visitors)
      }),

    'GET /visitors/:visitorId/notice-shown': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        if (!NOTICE_SHOWN_ENABLED) return errorResponse(404, 'Not found')

        const g = await guard(req, 'visitor:view'); if (g instanceof Response) return g
        const records = (await storage.getNoticeShownForVisitor(p['visitorId'] ?? '')).filter(r => r.tenantId === g.tenantId)
        return json(200, records)
      }),
  }
}
