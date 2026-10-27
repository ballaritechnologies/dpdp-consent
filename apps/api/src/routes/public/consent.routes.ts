import type { ConsentService } from '../../services/consent.service'
import type { VisitorService } from '../../services/visitor.service'
import type { ProfileService } from '../../services/profile.service'
import type { StorageAdapter } from '@consenti/types'
import type { EventEmitter } from 'node:events'
import { parseJsonBody, json } from '../../utils/http'
import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { buildOwnershipSetCookie, buildExpireOwnershipCookie, verifyOwnershipToken } from '../../utils/cookie'
import { buildParentalConsentToken, verifyParentalConsentToken } from '../../utils/parental-consent-token'
import { checkOriginAllowed } from '../../middleware/cors.middleware'
import {
  validateCreateConsent, validateUpdateConsent,
  castCreateConsent, castUpdateConsent,
} from '../../validators/consent.validator'
import { randomVisitorId, SiteKeys } from '../../utils/crypto'
import { forTenant, type PerTenant } from '../../services/tenant-services'
import { ErasureRequestError, type ErasureRequestService } from '../../services/erasure-request.service'
import { ParentalConsentError, type ParentalConsentService } from '../../services/parental-consent.service'

// Verify that the request's cookie contains a valid consenti_<visitorId> token,
// proving the caller is the actual visitor who originally submitted consent.
function assertVisitorOwnership(request: Request, visitorId: string, secret: string | string[]): Response | null {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const name = `consenti_${visitorId}`
  const owned = cookieHeader.split(';').some(c => {
    const trimmed = c.trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1 || trimmed.slice(0, eqIdx) !== name) return false
    return verifyOwnershipToken(trimmed.slice(eqIdx + 1), visitorId, secret)
  })
  if (!owned) return errorResponse(403, 'Forbidden')
  return null
}

export function buildConsentRoutes(
  consentsIn: PerTenant<ConsentService>,
  visitorsIn: PerTenant<VisitorService>,
  profilesIn: PerTenant<ProfileService>,
  resolveTenantId: (req: Request) => Promise<string> = async () => 'default',
  storage?: StorageAdapter,
  dataSigningHash: string | SiteKeys = '',
  eventBus?: EventEmitter,
  parentalConsentTokenTtlDays = 7,
  erasureRequests?: ErasureRequestService,
  parentalConsent?: ParentalConsentService,
) {
  // Each site signs ownership cookies and parental-consent tokens with its own key.
  const keys = typeof dataSigningHash === 'string' ? new SiteKeys(dataSigningHash) : dataSigningHash
  return {
    'POST /consent': async (request: Request, _params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const consents = forTenant(consentsIn, tenantId)
        const visitors = forTenant(visitorsIn, tenantId)
        const profiles = forTenant(profilesIn, tenantId)
        const body = await parseJsonBody(request)
        const validation = validateCreateConsent(body)
        if (!validation.valid) return errorResponse(400, validation.error ?? 'Invalid request')

        const b = body as Record<string, unknown>
        const profileId = typeof b['profileId'] === 'string' ? b['profileId'] : null
        if (!profileId) return errorResponse(400, 'profileId is required')

        // Layer 1: verify the profileId is real — blocks all requests with unknown profiles
        const profile = await profiles.get(profileId)
        if (!profile) return errorResponse(404, 'Profile not found')

        // Layer 3: enforce the profile's allowed-domains list, falling back to the tenant-wide
        // default (dashboard's API Config → Allowed Origins) when the profile doesn't set its own.
        const pjConfig = profile.profileJson as { allowedOrigins?: string[] }
        let allowedOrigins = pjConfig.allowedOrigins ?? []
        if (allowedOrigins.length === 0 && storage) {
          allowedOrigins = (await storage.getSettings(tenantId)).allowedOrigins ?? []
        }
        if (!checkOriginAllowed(request, allowedOrigins)) {
          return errorResponse(403, 'Origin not allowed for this profile')
        }

        const visitorId = typeof b['visitorId'] === 'string' ? b['visitorId'] : randomVisitorId()
        const ip = request.headers.get('x-real-ip') ?? ''
        const ua = request.headers.get('user-agent') ?? ''

        await visitors.upsert({ visitorId, ip, userAgent: ua })
        const input = castCreateConsent(b, visitorId, tenantId)
        const record = await consents.create(input)

        const setCookie = buildOwnershipSetCookie(visitorId, record.id, keys.for(tenantId))
        return new Response(JSON.stringify(record), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setCookie,
          },
        })
      }),

    'PUT /consent/:visitorId': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const consents = forTenant(consentsIn, tenantId)
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')

        // Layer 2: only the visitor's own browser may update their consent
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError

        const body = await parseJsonBody(request)
        const validation = validateUpdateConsent(body)
        if (!validation.valid) return errorResponse(400, validation.error ?? 'Invalid request')

        const input = castUpdateConsent(body as Record<string, unknown>)
        const record = await consents.update(visitorId, input)

        const setCookie = buildOwnershipSetCookie(visitorId, record.id, keys.for(tenantId))
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setCookie,
          },
        })
      }),

    'GET /consent/:visitorId': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const consents = forTenant(consentsIn, tenantId)
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')

        // Layer 2: only the visitor's own browser may read their consent
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError

        const record = await consents.get(visitorId)
        if (!record) return errorResponse(404, 'Consent not found')
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),

    'GET /consent/:visitorId/verify': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const consents = forTenant(consentsIn, tenantId)
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')

        // Layer 2: cookie ownership (browser calls); server-side callers use admin auth upstream
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError

        const result = await consents.verify(visitorId)
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),

    'DELETE /consent/:visitorId': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const consents = forTenant(consentsIn, tenantId)
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')

        // Layer 2: only the visitor's own browser may erase their consent
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError

        const existing = await consents.get(visitorId)
        await consents.erase(visitorId)
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (existing) {
          headers['Set-Cookie'] = buildExpireOwnershipCookie(visitorId)
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers })
      }),

    // A visitor asks for their data to be deleted. Unlike DELETE /consent (which erases the
    // consent record straight away), this opens a request in the dashboard's deletion inbox,
    // for data held outside the consent record. Ownership as above; contact and message optional.
    'POST /consent/:visitorId/erasure-request': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        if (!erasureRequests) return errorResponse(404, 'Not found')
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')
        const tenantId = await resolveTenantId(request)
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError
        const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {}
        if (typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'Invalid JSON body')
        try {
          const created = await erasureRequests.create({
            tenantId, channel: 'widget', visitorId,
            contact: body['contact'] as string | null, message: body['message'] as string | null,
          })
          return json(201, { id: created.id, status: created.status, dueAt: created.dueAt })
        } catch (err) {
          if (err instanceof ErasureRequestError) return errorResponse(err.status, err.message)
          throw err
        }
      }),

    // Stateless parental-consent hook — plumbing for a host to wire up their own out-of-band
    // verification method (see AGE_GATE docs); not by itself sufficient verifiable parental
    // consent. No persistence: the token itself carries everything needed to resolve it, and
    // replay isn't prevented (accepted tradeoff of staying stateless).
    'POST /consent/:visitorId/parental-consent-request': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const tenantId = await resolveTenantId(request)
        const profiles = forTenant(profilesIn, tenantId)
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')

        // Layer 2: only the visitor's own browser may request a parental-consent token for them
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError

        const body = await parseJsonBody(request) as Record<string, unknown>
        const profileId = typeof body['profileId'] === 'string' ? body['profileId'] : null
        if (!profileId) return errorResponse(400, 'profileId is required')
        if (!(await profiles.get(profileId))) return errorResponse(404, 'Profile not found')

        const token = buildParentalConsentToken(visitorId, profileId, keys.for(tenantId))
        const issuedAt = Math.round(Date.now() / 1000)
        // Recorded (and started with the configured provider, if any) before the event, so a
        // listener can already look the request up.
        let started = null
        if (parentalConsent) {
          const locale = typeof body['locale'] === 'string' && body['locale'].length <= 35 ? body['locale'] : null
          try {
            started = await parentalConsent.request(tenantId, visitorId, profileId, locale)
          } catch (err) {
            if (err instanceof ParentalConsentError) return errorResponse(err.status, err.message)
            throw err
          }
        }
        eventBus?.emit('consent.parentalConsentRequired', { visitorId, profileId, token, issuedAt, ...(started ? { requestId: started.id } : {}) })
        return json(200, {
          token,
          ...(started ? {
            requestId: started.id, status: started.status,
            ...(started.data.redirectUrl ? { redirectUrl: started.data.redirectUrl } : {}),
            ...(started.data.message ? { message: started.data.message } : {}),
          } : {}),
        })
      }),

    'POST /consent/parental-consent-resolve': async (request: Request): Promise<Response> =>
      withErrorHandler(async () => {
        const body = await parseJsonBody(request) as Record<string, unknown>
        const token = typeof body['token'] === 'string' ? body['token'] : null
        if (!token) return errorResponse(400, 'token is required')

        const tenantId = await resolveTenantId(request)
        const result = verifyParentalConsentToken(token, keys.verifying(tenantId), parentalConsentTokenTtlDays)
        if (!result.valid) return errorResponse(403, `Invalid or expired token (${result.reason})`)

        await parentalConsent?.verifyByToken(tenantId, result.visitorId, result.profileId)
        eventBus?.emit('consent.parentalConsentGranted', { visitorId: result.visitorId, profileId: result.profileId })
        return json(200, { visitorId: result.visitorId, profileId: result.profileId })
      }),

    // The visitor's own browser asks whether a parent's consent has been verified yet.
    'GET /consent/:visitorId/parental-consent': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const visitorId = params['visitorId']
        if (!visitorId) return errorResponse(400, 'Missing visitorId')
        const tenantId = await resolveTenantId(request)
        const ownershipError = assertVisitorOwnership(request, visitorId, keys.verifying(tenantId))
        if (ownershipError) return ownershipError
        const latest = parentalConsent ? await parentalConsent.latest(tenantId, visitorId) : null
        if (!latest) return json(200, { status: 'none' })
        return json(200, {
          status: latest.status, requestId: latest.id,
          ...(latest.status === 'pending' && latest.data.redirectUrl ? { redirectUrl: latest.data.redirectUrl } : {}),
        })
      }),
  }
}
