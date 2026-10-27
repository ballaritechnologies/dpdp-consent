// `details` is always sent when the caller passes it — every call site in the routes layer
// passes deliberate, non-sensitive, user-facing structure (missing-field lists, compliance
// errors, blocking-profile ids), never raw internals. The one place that touches an actual
// exception message (`withErrorHandler` below) does its own production check before it ever
// reaches here, so gating again in this shared helper would only suppress the safe kind.
export function errorResponse(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message }
  if (details != null) {
    body['details'] = details
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Thrown anywhere under `withErrorHandler` to answer with a specific status and safe message. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function withErrorHandler(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message)
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return errorResponse(500, 'Internal Server Error',
      process.env['NODE_ENV'] !== 'production' ? message : undefined)
  }
}
