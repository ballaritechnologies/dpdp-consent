import { createHash } from 'node:crypto'
import type { StorageAdapter } from '@consenti/types'
import { HttpError } from './error.middleware'
import { isSafeTenantId } from '../utils/path-segment'

export async function resolveTenant(
  req: Request,
  storage: StorageAdapter,
  defaultTenantId: string,
): Promise<string> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ck_')) return defaultTenantId

  const rawKey = auth.slice(7)
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const apiKey = await storage.getApiKeyByHash(keyHash)
  if (!apiKey || !apiKey.isActive) return defaultTenantId

  if (apiKey.expireBy && new Date(apiKey.expireBy) <= new Date()) {
    // Lazy expiration: no background sweep — the first request (or dashboard list load) to
    // notice an expired key flips it, so it reads correctly from then on.
    await storage.revokeApiKey(apiKey.id).catch(() => {})
    return defaultTenantId
  }

  return apiKey.tenantId
}

const KNOWN_TENANTS_TTL_MS = 30_000

/**
 * Site (tenant) of a public request on a multi-site server: the API key's site when a `ck_` key
 * is sent, otherwise `?tenant=` (what the widget sends for a non-default site), otherwise
 * `default`. An unknown or malformed `?tenant=` is rejected with 400 rather than falling back to
 * `default`, so one site's data can never land in another's.
 */
export function publicTenantResolver(storage: StorageAdapter): (req: Request) => Promise<string> {
  let known: { ids: Set<string>; at: number } | null = null
  const exists = async (id: string): Promise<boolean> => {
    // Reload when stale, or on a miss (a site created moments ago) at most every 5 s, so a flood
    // of made-up site IDs can't turn into one storage read each.
    const age = known ? Date.now() - known.at : Infinity
    if (!known || age > KNOWN_TENANTS_TTL_MS || (!known.ids.has(id) && age > 5_000)) {
      known = { ids: new Set((await storage.getTenants()).map(t => t.id)), at: Date.now() }
    }
    return known.ids.has(id)
  }
  return async (req: Request) => {
    if (req.headers.get('authorization')?.startsWith('Bearer ck_')) return resolveTenant(req, storage, 'default')
    const requested = new URL(req.url).searchParams.get('tenant')
    if (requested === null || requested === '' || requested === 'default') return 'default'
    if (!isSafeTenantId(requested) || !(await exists(requested))) throw new HttpError(400, 'Unknown site')
    return requested
  }
}
