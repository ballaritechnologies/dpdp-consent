import type {
  StorageAdapter, Visitor, CreateVisitorInput, UpdateVisitorInput,
} from '@consenti/types'

export class VisitorRepo {
  constructor(private adapter: StorageAdapter) {}

  create(data: CreateVisitorInput): Promise<Visitor> {
    return this.adapter.createVisitor(data)
  }

  update(visitorId: string, data: UpdateVisitorInput, tenantId?: string): Promise<Visitor> {
    return this.adapter.updateVisitor(visitorId, data, tenantId)
  }

  delete(visitorId: string, tenantId?: string): Promise<void> {
    return this.adapter.deleteVisitor(visitorId, tenantId)
  }

  get(visitorId: string, tenantId?: string): Promise<Visitor | null> {
    return this.adapter.getVisitor(visitorId, tenantId)
  }
}
