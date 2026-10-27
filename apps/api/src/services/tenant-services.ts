import type { ProfileService } from './profile.service'
import type { ConsentService } from './consent.service'
import type { VisitorService } from './visitor.service'
import type { NoticeService } from './notice.service'

/** The site-bound services one request works with. */
export interface TenantServiceBundle {
  profiles: ProfileService
  consents: ConsentService
  visitors: VisitorService
  notices: NoticeService
}

/**
 * Builds each site's services once and reuses them. ProfileService, ConsentService, VisitorService
 * and NoticeService are bound to one site (records they create carry it, and records of other
 * sites read as not found), so a multi-site server needs one set per site.
 */
export class TenantServices {
  /** Least recently used first; `default` is never evicted. */
  private cache = new Map<string, TenantServiceBundle>()
  static readonly MAX_SITES = 500

  constructor(private build: (tenantId: string) => TenantServiceBundle, defaults?: TenantServiceBundle) {
    if (defaults) this.cache.set('default', defaults)
  }

  for(tenantId: string): TenantServiceBundle {
    let bundle = this.cache.get(tenantId)
    if (bundle) {
      this.cache.delete(tenantId)
    } else {
      bundle = this.build(tenantId)
      // Bounded, so requests naming made-up site IDs can't grow memory without limit.
      if (this.cache.size >= TenantServices.MAX_SITES) {
        const oldest = [...this.cache.keys()].find(k => k !== 'default')
        if (oldest !== undefined) this.cache.delete(oldest)
      }
    }
    this.cache.set(tenantId, bundle)
    return bundle
  }
}

/** A service, or a function giving the service for a site: route builders accept either, so a
 * single-site setup (and tests) can pass plain instances. */
export type PerTenant<T> = T | ((tenantId: string) => T)

export function forTenant<T extends object>(value: PerTenant<T>, tenantId: string): T {
  return typeof value === 'function' ? (value as (tenantId: string) => T)(tenantId) : value
}
