// Shared by the Ijazat admin routes (records, incidents): tenant-aware permission check and
// streamed CSV/JSON exports.
import type { StorageAdapter, AuthConfig } from '@consenti/types'
import { errorResponse } from '../../middleware/error.middleware'
import { authenticate, authError, type AuthenticatedUser } from '../../middleware/auth.middleware'

export const EXPORT_PAGE = 1000

/** `guard(req, permission)`: the caller and the `?tenantId=` they target (default `'default'`),
 * or an error response when they lack the permission or may not use that tenant. */
export function tenantGuard(storage: StorageAdapter, authConfig: AuthConfig, secret: string) {
  return async function guard(req: Request, permission: string): Promise<{ user: AuthenticatedUser; tenantId: string } | Response> {
    const user = await authenticate(req, storage, authConfig, secret)
    const denied = authError(user, permission)
    if (denied || !user) return denied ?? errorResponse(401, 'Unauthorized')
    const tenantId = new URL(req.url).searchParams.get('tenantId') || 'default'
    if (user.allowedTenants.length > 0 && !user.allowedTenants.includes(tenantId)) {
      return errorResponse(403, 'Not allowed for this tenant')
    }
    if (tenantId !== 'default' && !(await storage.getTenants()).some(t => t.id === tenantId)) {
      return errorResponse(404, 'Tenant not found')
    }
    return { user, tenantId }
  }
}

function csvCell(val: unknown): string {
  const s = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
  // Leading = + - @ would run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\n'
}

/** Streams every matching record, page by page, as CSV or one JSON array. */
export function exportResponse<T>(
  format: string, name: string, header: string[], toRow: (r: T) => unknown[],
  page: (offset: number) => Promise<T[]>,
): Response {
  const enc = new TextEncoder()
  const isJson = format === 'json'
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(isJson ? '[' : csvRow(header)))
        let offset = 0
        let first = true
        for (;;) {
          const rows = await page(offset)
          for (const r of rows) {
            controller.enqueue(enc.encode(isJson ? `${first ? '' : ','}${JSON.stringify(r)}` : csvRow(toRow(r))))
            first = false
          }
          if (rows.length < EXPORT_PAGE) break
          offset += rows.length
        }
        if (isJson) controller.enqueue(enc.encode(']'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': isJson ? 'application/json' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.${isJson ? 'json' : 'csv'}"`,
    },
  })
}

export function exportFormat(url: URL): string | Response {
  const f = url.searchParams.get('format') ?? 'csv'
  return f === 'csv' || f === 'json' ? f : errorResponse(400, 'format must be csv or json')
}
