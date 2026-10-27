import type { StorageAdapter, AuthConfig } from '@consenti/types'
import { json, getQueryInt } from '../../utils/http'
import { withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'
import type { StatsService } from '../../services/stats.service'

export function buildAdminStatsRoutes(
  storage: StorageAdapter,
  stats: StatsService,
  authConfig: AuthConfig,
  secret: string,
) {
  const guard = tenantGuard(storage, authConfig, secret)

  return {
    'GET /stats/overview': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const overview = await stats.getOverview(g.tenantId)
        return json(200, overview)
      }),

    'GET /stats/categories': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const categories = await stats.getCategories(g.tenantId)
        return json(200, categories)
      }),

    'GET /stats/timeline': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const url = new URL(req.url)
        const days = getQueryInt(url, 'days', 30)
        const timeline = await stats.getTimeline(g.tenantId, days)
        return json(200, timeline)
      }),

    'GET /stats/countries': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const countries = await stats.getCountries(g.tenantId)
        return json(200, countries)
      }),

    'GET /stats/gpc': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        const gpc = await stats.getGpc(g.tenantId)
        return json(200, gpc)
      }),

    'GET /stats/aggregate': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'consent:view'); if (g instanceof Response) return g
        // Only the sites this user may see (no restriction = every site).
        const allowed = g.user.allowedTenants
        const tenants = (await stats.getTenants()).filter(t => allowed.length === 0 || allowed.includes(t.id))
        const rows = await Promise.all(
          tenants.map(async t => {
            const s = await stats.getOverview(t.id)
            return { tenantId: t.id, tenantName: t.name, ...s }
          }),
        )
        const aggregate = rows.reduce(
          (acc, r) => ({
            totalConsents: acc.totalConsents + r.totalConsents,
            totalVisitors: acc.totalVisitors + r.totalVisitors,
            gpcDetectedCount: acc.gpcDetectedCount + r.gpcDetectedCount,
          }),
          { totalConsents: 0, totalVisitors: 0, gpcDetectedCount: 0 },
        )
        return json(200, { aggregate, perTenant: rows })
      }),
  }
}
