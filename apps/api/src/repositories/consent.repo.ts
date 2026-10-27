import type {
  StorageAdapter, ConsentDbRecord, ConsentSummary, CreateConsentInput, UpdateConsentInput,
  ConsentFilters, PagedResult,
} from '@consenti/types'

export class ConsentRepo {
  constructor(private adapter: StorageAdapter) {}

  create(data: CreateConsentInput): Promise<ConsentDbRecord> {
    return this.adapter.createConsent(data)
  }

  update(visitorId: string, data: UpdateConsentInput, tenantId?: string): Promise<ConsentDbRecord> {
    return this.adapter.updateConsent(visitorId, data, tenantId)
  }

  delete(visitorId: string, tenantId?: string): Promise<void> {
    return this.adapter.deleteConsent(visitorId, tenantId)
  }

  get(visitorId: string, tenantId?: string): Promise<ConsentDbRecord | null> {
    return this.adapter.getConsent(visitorId, tenantId)
  }

  list(filters: ConsentFilters): Promise<PagedResult<ConsentSummary>> {
    return this.adapter.getConsents(filters)
  }
}
