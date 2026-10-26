import type { TenantSettings } from '@consenti/types'
import { isComplianceGroupId, isRegimeId } from '@consenti/utils'

type RegimeFields = Pick<TenantSettings, 'regime' | 'regimeDefaultGroup'>

/** `tenant_settings.regime_json` value for SQL adapters — `null` when no regime is set, so an
 * unset regime and a never-written row read back the same way. */
export function regimeToColumn(settings: RegimeFields): string | null {
  if (!settings.regime) return null
  return JSON.stringify({
    regime: settings.regime,
    ...(settings.regimeDefaultGroup ? { regimeDefaultGroup: settings.regimeDefaultGroup } : {}),
  })
}

/** Accepts the raw column value (a JSON string from SQLite/MySQL, an already-parsed object from
 * Postgres JSONB or a Mongo document) and drops anything that isn't a known regime/group, so a
 * hand-edited row can never route visitors to an unknown group. */
export function regimeFromColumn(raw: unknown): RegimeFields {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return {} }
  }
  if (!value || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  if (!isRegimeId(v['regime'])) return {}
  return {
    regime: v['regime'],
    ...(isComplianceGroupId(v['regimeDefaultGroup']) ? { regimeDefaultGroup: v['regimeDefaultGroup'] } : {}),
  }
}
