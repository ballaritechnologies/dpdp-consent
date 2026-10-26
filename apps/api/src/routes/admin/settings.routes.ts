import type { StorageAdapter, AuthConfig, TenantSettings } from '@consenti/types'
import { REGIMES, isComplianceGroupId, isRegimeId } from '@consenti/utils'
import { json, parseJsonBody } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { authenticate, authError } from '../../middleware/auth.middleware'

/** Tenant-wide dashboard settings — the public and admin API origin allowlists shown on the
 * API Config page, and the per-site consent regime. `?tenantId=` selects the tenant (subject to
 * the caller's `allowedTenants`); omitted, it is `'default'`, which is all single-tenant
 * deployments ever use. */
export function buildAdminSettingsRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
) {
  async function auth(req: Request) {
    const user = await authenticate(req, storage, authConfig, secret)
    return { user, denied: authError(user, 'settings:update') }
  }

  /** The tenant this request targets, or an error response when the caller may not use it. */
  async function targetTenant(req: Request, user: { allowedTenants: string[] } | null): Promise<string | Response> {
    const tenantId = new URL(req.url).searchParams.get('tenantId') || 'default'
    if (!user || (user.allowedTenants.length > 0 && !user.allowedTenants.includes(tenantId))) {
      return errorResponse(403, 'Not allowed for this tenant')
    }
    if (tenantId !== 'default' && !(await storage.getTenants()).some(t => t.id === tenantId)) {
      return errorResponse(404, 'Tenant not found')
    }
    return tenantId
  }

  return {
    'GET /settings': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const { user, denied } = await auth(req)
        if (denied) return denied
        const tenantId = await targetTenant(req, user)
        if (tenantId instanceof Response) return tenantId
        const settings = await storage.getSettings(tenantId)
        return json(200, settings)
      }),

    'PATCH /settings': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const { user, denied } = await auth(req)
        if (denied) return denied
        const tenantId = await targetTenant(req, user)
        if (tenantId instanceof Response) return tenantId
        const body = await parseJsonBody(req)
        if (!body || typeof body !== 'object') return errorResponse(400, 'Invalid body')
        const b = body as Record<string, unknown>
        if (b['allowedOrigins'] !== undefined && !Array.isArray(b['allowedOrigins'])) {
          return errorResponse(400, 'allowedOrigins must be an array of strings')
        }
        if (b['adminAllowedOrigins'] !== undefined && !Array.isArray(b['adminAllowedOrigins'])) {
          return errorResponse(400, 'adminAllowedOrigins must be an array of strings')
        }

        const regimeUpdate: Pick<TenantSettings, 'regime' | 'regimeDefaultGroup'> = {}
        const regime = b['regime']
        if (regime !== undefined) {
          if (regime !== null && !isRegimeId(regime)) {
            return errorResponse(400, 'regime must be one of "dpdp", "dpdp_gdpr", "strictest_global", or null')
          }
          if (regime !== null && !REGIMES[regime].implemented) {
            return errorResponse(501, `Regime "${regime}" is not implemented`)
          }
          regimeUpdate.regime = regime ?? undefined
        }
        const defaultGroup = b['regimeDefaultGroup']
        if (defaultGroup !== undefined) {
          if (defaultGroup !== null && !isComplianceGroupId(defaultGroup)) {
            return errorResponse(400, 'regimeDefaultGroup must be a built-in compliance group id, or null')
          }
          regimeUpdate.regimeDefaultGroup = defaultGroup ?? undefined
        }

        const before = Object.keys(regimeUpdate).length > 0 ? await storage.getSettings(tenantId) : null
        const settings = await storage.updateSettings(tenantId, {
          ...(b['allowedOrigins'] !== undefined ? { allowedOrigins: b['allowedOrigins'] as string[] } : {}),
          ...(b['adminAllowedOrigins'] !== undefined ? { adminAllowedOrigins: b['adminAllowedOrigins'] as string[] } : {}),
          ...regimeUpdate,
        })
        // A regime decides which consent flow every visitor sees, so each change is kept as evidence.
        if (before && (before.regime !== settings.regime || before.regimeDefaultGroup !== settings.regimeDefaultGroup)) {
          await storage.createLog({
            tenantId,
            ...(user ? { userId: user.sub } : {}),
            action: 'settings:regime_updated',
            resourceType: 'settings',
            resourceId: tenantId,
            oldData: { regime: before.regime ?? null, regimeDefaultGroup: before.regimeDefaultGroup ?? null },
            newData: { regime: settings.regime ?? null, regimeDefaultGroup: settings.regimeDefaultGroup ?? null },
          })
        }
        return json(200, settings)
      }),
  }
}
