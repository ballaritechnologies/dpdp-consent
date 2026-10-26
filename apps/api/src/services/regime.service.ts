import type { TenantSettings } from '@consenti/types'
import { isComplianceGroupId, isRegimeId, resolveRegimeGroup } from '@consenti/utils'
import type { ResolvedGeo } from './geo-resolver.service'

/**
 * Applies a tenant's consent regime (`TenantSettings.regime`) on top of a jurisdiction-map
 * resolution. With no regime set, the map's own group is returned unchanged — so tenants that
 * never opt in keep exactly the routing they had before regimes existed.
 */
export class RegimeService {
  constructor(private readonly getSettings: (tenantId: string) => Promise<TenantSettings>) {}

  /** Throws `RegimeNotImplementedError` for `strictest_global`. */
  async apply(tenantId: string, geo: ResolvedGeo): Promise<ResolvedGeo> {
    const { regime, regimeDefaultGroup } = await this.getSettings(tenantId)
    if (!isRegimeId(regime)) return geo

    const complianceGroup = resolveRegimeGroup(
      regime,
      geo.country,
      isComplianceGroupId(regimeDefaultGroup) ? regimeDefaultGroup : undefined,
    )
    if (complianceGroup === geo.complianceGroup) return geo

    // `requiresSensitiveOptIn` is a carve-out of the map's own group (US state law); once the
    // regime routes the visitor elsewhere it no longer applies.
    const { requiresSensitiveOptIn: _dropped, ...rest } = geo
    return { ...rest, complianceGroup }
  }
}
