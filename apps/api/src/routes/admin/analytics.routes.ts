import type { StorageAdapter, AuthConfig, OptInFilters } from '@consenti/types'
import { json } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'

export function buildAdminAnalyticsRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
) {
  const guard = tenantGuard(storage, authConfig, secret)

  return {
    'GET /analytics/opt-in': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'stats:view'); if (g instanceof Response) return g

        const url = new URL(req.url)
        const tenantId = g.tenantId

        const filters: OptInFilters = {}
        const profileId = url.searchParams.get('profileId')
        const complianceGroup = url.searchParams.get('complianceGroup')
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        const locale = url.searchParams.get('locale')

        if (profileId) filters.profileId = profileId
        if (complianceGroup) filters.complianceGroup = complianceGroup
        if (from) filters.from = from
        if (to) filters.to = to
        if (locale) filters.locale = locale

        const stats = await storage.getOptInStats(tenantId, filters)
        return json(200, stats)
      }),
  }
}
