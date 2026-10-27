import { errorResponse, withErrorHandler } from '../../middleware/error.middleware'
import { json } from '../../utils/http'
import { ConsentManagerError, type ConsentManagerService } from '../../services/consent-manager.service'

const MAX_BODY = 64 * 1024

/**
 * Notifications from registered Consent Managers. No Ijazat auth: each adapter authenticates its
 * own notifications (signature, mTLS, …) in `verifyNotification`, and anything it can't verify is
 * rejected with 401.
 */
export function buildConsentManagerRoutes(service: ConsentManagerService, resolveTenantId: (req: Request) => Promise<string>) {
  return {
    'POST /consent-managers/:adapterId/notify': async (request: Request, params: Record<string, string>): Promise<Response> =>
      withErrorHandler(async () => {
        const body = await request.text()
        if (body.length > MAX_BODY) return errorResponse(413, 'Notification too large')
        const headers: Record<string, string> = {}
        request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
        try {
          const record = await service.handleNotification(await resolveTenantId(request), params['adapterId'] ?? '', { headers, body })
          return json(200, { received: true, status: record.status })
        } catch (err) {
          if (err instanceof ConsentManagerError) return errorResponse(err.status, err.message)
          throw err
        }
      }),
  }
}
