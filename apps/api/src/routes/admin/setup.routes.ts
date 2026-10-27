import type { StorageAdapter, AuthConfig, ConsentiServerConfig } from '@consenti/types'
import { COMPLIANCE_GROUP_IDS, COMPLIANCE_GROUPS } from '@consenti/utils'
import { json, parseJsonBody } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'
import { forTenant, type PerTenant } from '../../services/tenant-services'
import { sanitizeConfigForDisplay } from '../../utils/sanitize-config'
import type { ProfileService } from '../../services/profile.service'

/** First-run setup wizard — one time per tenant, gated by `tenant_settings.setup_completed`.
 * Never reset from the dashboard once true (see plans/DONE-api-setup-wizard.md). */
export function buildAdminSetupRoutes(
  profileServiceIn: PerTenant<ProfileService>,
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
  config: ConsentiServerConfig,
  readiness: { usingJsonStorage: boolean; usingDefaultCredentials: boolean },
) {
  const guard = tenantGuard(storage, authConfig, secret)

  /** Blocks the two mutating setup routes once setup is already complete — the wizard is a
   * one-time installer, not something callable again via a direct API request either. */
  async function rejectIfCompleted(tenantId: string): Promise<Response | null> {
    const settings = await storage.getSettings(tenantId)
    if (settings.setupCompleted === true) return errorResponse(409, 'Setup has already been completed')
    return null
  }

  return {
    'GET /setup/status': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const settings = await storage.getSettings(g.tenantId)
        return json(200, { completed: settings.setupCompleted === true })
      }),

    'GET /setup/config': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        return json(200, { config: sanitizeConfigForDisplay(config), ...readiness })
      }),

    'GET /setup/compliance-groups': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const groups = COMPLIANCE_GROUP_IDS.map(id => ({ id, ...COMPLIANCE_GROUPS[id] }))
        return json(200, groups)
      }),

    'POST /setup/seed-profiles': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const completed = await rejectIfCompleted(g.tenantId)
        if (completed) return completed
        const body = await parseJsonBody(req)
        const groups = (body as { groups?: unknown } | null)?.groups
        if (!Array.isArray(groups) || groups.some(x => typeof x !== 'string')) {
          return errorResponse(400, 'groups must be an array of compliance group ids')
        }
        const unknown = groups.filter(x => !(COMPLIANCE_GROUP_IDS as readonly string[]).includes(x))
        if (unknown.length > 0) {
          return errorResponse(400, `Unknown compliance group id(s): ${unknown.join(', ')}`)
        }
        await Promise.all((groups as string[]).map(group => forTenant(profileServiceIn, g.tenantId).seedDefaultProfile(group)))
        await storage.updateSettings(g.tenantId, { profilesSeeded: true })
        return json(200, { seeded: groups })
      }),

    'POST /setup/complete': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'settings:update'); if (g instanceof Response) return g
        const completed = await rejectIfCompleted(g.tenantId)
        if (completed) return completed
        const settings = await storage.getSettings(g.tenantId)
        if (settings.profilesSeeded !== true) {
          return errorResponse(409, 'POST /setup/seed-profiles must be called at least once (an empty groups: [] call is a valid pass) before setup can be completed')
        }
        const updated = await storage.updateSettings(g.tenantId, { setupCompleted: true })
        return json(200, updated)
      }),
  }
}
