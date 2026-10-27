import type { StorageAdapter, AuthConfig, ConsentFilters } from '@consenti/types'
import { json, getQueryParam, getPagination } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'

export function buildAdminConsentRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
) {
  const guard = tenantGuard(storage, authConfig, secret)

  return {
    'GET /consents': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const profileId = getQueryParam(url, 'profileId')
        const from = getQueryParam(url, 'from')
        const to = getQueryParam(url, 'to')
        const q = getQueryParam(url, 'q')
        const pagination = getPagination(url)
        if ('error' in pagination) return errorResponse(400, pagination.error)
        const { page, limit } = pagination
        const filters: ConsentFilters = {
          tenantId: g.tenantId,
          page,
          limit,
          ...(profileId !== undefined ? { profileId } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          ...(q !== undefined ? { q } : {}),
        }
        const records = await storage.getConsents(filters)
        return json(200, records)
      }),

    'GET /consents/:visitorId': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const record = await storage.getConsent(p['visitorId'] ?? '', g.tenantId)
        if (!record || record.tenantId !== g.tenantId) return errorResponse(404, 'Consent not found')
        return json(200, record)
      }),

    'GET /consents/:visitorId/history': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const history = (await storage.getConsentHistory(p['visitorId'] ?? '', g.tenantId)).filter(h => h.tenantId === g.tenantId)
        return json(200, history)
      }),
  }
}
