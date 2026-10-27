import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageAdapter, AuthConfig } from '@consenti/types'
import { json, parseJsonBody } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { allSitesOnly, authenticate, authError } from '../../middleware/auth.middleware'

export function buildAdminTenantRoutes(
  storage: StorageAdapter,
  authConfig: AuthConfig,
  secret: string,
  /** Where profile files are kept (`<profilesDir>/<site id>/…`); removed with the site. */
  profilesDir?: string,
) {
  async function auth(req: Request, perm: string) {
    const user = await authenticate(req, storage, authConfig, secret)
    return { user, denied: authError(user, perm) }
  }

  return {
    'GET /tenants': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        // Any signed-in user may list the sites they work on (the dashboard's site picker).
        const user = await authenticate(req, storage, authConfig, secret)
        if (!user) return errorResponse(401, 'Unauthorized')
        // A user limited to some sites only sees those.
        const allowed = user.allowedTenants
        const tenants = (await storage.getTenants()).filter(t => allowed.length === 0 || allowed.includes(t.id))
        return json(200, tenants)
      }),

    'POST /tenants': async (req: Request, _p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const { user, denied } = await auth(req, 'settings:update')
        if (denied || !user) return denied ?? errorResponse(401, 'Unauthorized')
        // Creating, renaming and deleting sites changes every site: only users not limited to some.
        const limited = allSitesOnly(user); if (limited) return limited
        const body = await parseJsonBody(req)
        if (!body || typeof body !== 'object') return errorResponse(400, 'Invalid body')
        const b = body as Record<string, unknown>
        if (typeof b['name'] !== 'string' || typeof b['slug'] !== 'string') {
          return errorResponse(400, 'name and slug are required')
        }
        const tenant = await storage.createTenant({ name: b['name'], slug: b['slug'] })
        return json(201, tenant)
      }),

    'PUT /tenants/:id': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const { user, denied } = await auth(req, 'settings:update')
        if (denied || !user) return denied ?? errorResponse(401, 'Unauthorized')
        // Creating, renaming and deleting sites changes every site: only users not limited to some.
        const limited = allSitesOnly(user); if (limited) return limited
        const body = await parseJsonBody(req)
        if (!body || typeof body !== 'object') return errorResponse(400, 'Invalid body')
        const b = body as Record<string, unknown>
        const tenant = await storage.updateTenant(p['id'] ?? '', {
          ...(typeof b['name'] === 'string' ? { name: b['name'] } : {}),
          ...(typeof b['slug'] === 'string' ? { slug: b['slug'] } : {}),
        })
        return json(200, tenant)
      }),

    'DELETE /tenants/:id': async (req: Request, p: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const { user, denied } = await auth(req, 'settings:update')
        if (denied || !user) return denied ?? errorResponse(401, 'Unauthorized')
        // Creating, renaming and deleting sites changes every site: only users not limited to some.
        const limited = allSitesOnly(user); if (limited) return limited
        const id = p['id'] ?? ''
        if (id === 'default') return errorResponse(400, 'Cannot delete the default tenant')
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return errorResponse(400, 'Invalid site ID')
        if (!(await storage.getTenants()).some(t => t.id === id)) return errorResponse(404, 'Site not found')
        // Everything stored for the site goes: its records in the database, then its profile files.
        await storage.deleteTenant(id)
        if (profilesDir) await rm(join(profilesDir, id), { recursive: true, force: true })
        return json(200, { success: true })
      }),
  }
}
