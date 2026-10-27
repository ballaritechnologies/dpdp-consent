import type { StorageAdapter, AuthConfig } from '@consenti/types'
import { json, parseJsonBody } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { tenantGuard } from './route-helpers'

export function buildAdminUITemplateRoutes(storage: StorageAdapter, authConfig: AuthConfig, secret: string) {
  const guard = tenantGuard(storage, authConfig, secret)

  /** The template, if it belongs to this site. */
  async function own(id: string | undefined, tenantId: string) {
    const t = await storage.getUITemplate(id ?? '')
    return t && t.tenantId === tenantId ? t : null
  }

  return {
    'GET /ui-templates': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:view'); if (g instanceof Response) return g
        return json(200, await storage.getUITemplates(g.tenantId))
      }),

    'GET /ui-templates/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:view'); if (g instanceof Response) return g
        if (!(await own(params['id'], g.tenantId))) return errorResponse(404, 'UI template not found')
        const t = await storage.getUITemplate(params['id']!)
        return t ? json(200, t) : errorResponse(404, 'UI template not found')
      }),

    'POST /ui-templates': async (req: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:create'); if (g instanceof Response) return g
        const body = await parseJsonBody<Record<string, unknown>>(req)
        if (!body?.name || typeof body.name !== 'string') return errorResponse(400, 'name is required')
        if (!body.mainBanner || !body.gpcBanner || !body.preferenceModal) return errorResponse(400, 'mainBanner, gpcBanner, and preferenceModal are required')
        const t = await storage.createUITemplate({
          tenantId: g.tenantId,
          name: body.name,
          mainBanner: body.mainBanner as never,
          gpcBanner: body.gpcBanner as never,
          preferenceModal: body.preferenceModal as never,
        })
        return json(201, t)
      }),

    'PUT /ui-templates/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:update'); if (g instanceof Response) return g
        if (!(await own(params['id'], g.tenantId))) return errorResponse(404, 'UI template not found')
        const body = await parseJsonBody<Record<string, unknown>>(req)
        const update: Record<string, unknown> = {}
        if (typeof body?.name === 'string') update['name'] = body.name
        if (body?.mainBanner) update['mainBanner'] = body.mainBanner
        if (body?.gpcBanner) update['gpcBanner'] = body.gpcBanner
        if (body?.preferenceModal) update['preferenceModal'] = body.preferenceModal
        const t = await storage.updateUITemplate(params['id']!, update as never)
        return json(200, t)
      }),

    'DELETE /ui-templates/:id': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:delete'); if (g instanceof Response) return g
        if (!(await own(params['id'], g.tenantId))) return errorResponse(404, 'UI template not found')
        const id = params['id']!
        const profiles = await storage.findProfilesUsingUITemplate(id)
        if (profiles.length > 0) {
          return errorResponse(422, 'Cannot delete: template is used by profiles', {
            profiles: profiles.map(p => ({ id: p.id, name: p.name, isActive: p.isActive })),
          })
        }
        await storage.deleteUITemplate(id)
        return json(200, { ok: true })
      }),

    'POST /ui-templates/:id/copy': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:create'); if (g instanceof Response) return g
        if (!(await own(params['id'], g.tenantId))) return errorResponse(404, 'UI template not found')
        const body = await parseJsonBody<{ name?: unknown }>(req)
        const src = await storage.getUITemplate(params['id']!)
        if (!src) return errorResponse(404, 'UI template not found')
        const newName = (typeof body?.name === 'string' && body.name.trim()) ? body.name.trim() : `${src.name} (Copy)`
        const t = await storage.copyUITemplate(params['id']!, newName)
        return json(201, t)
      }),

    'GET /ui-templates/:id/profile-usage': async (req: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const g = await guard(req, 'profile:view'); if (g instanceof Response) return g
        if (!(await own(params['id'], g.tenantId))) return errorResponse(404, 'UI template not found')
        const usage = await storage.findProfilesUsingUITemplate(params['id']!)
        return json(200, usage)
      }),
  }
}
