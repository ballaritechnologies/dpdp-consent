import type { StorageAdapter, Profile, NoticeVersion, NoticeVersionData, EntityListOptions } from '@consenti/types'
import { createHash } from 'node:crypto'

import { sortableEntityId } from '../storage/entity-sql'
export interface NoticeVersionWriter {
  record(profile: Profile, change: NoticeVersionData['change'], actorId: string | null): Promise<NoticeVersion>
}

/**
 * Notice version history: one entry per saved profile version, with the DPDP notice version and
 * review status, and a hash of the exact profile JSON. The full text of each version stays in the
 * on-disk snapshots ProfileService already writes; this is the searchable index over them, kept
 * even after a profile is deleted.
 */
export class NoticeVersionService implements NoticeVersionWriter {
  constructor(private storage: StorageAdapter) { }

  async record(profile: Profile, change: NoticeVersionData['change'], actorId: string | null): Promise<NoticeVersion> {
    const pj = profile.profileJson
    const now = new Date().toISOString()
    const entry: NoticeVersion = {
      id: sortableEntityId('ntv'),
      tenantId: profile.tenantId,
      collection: 'notice_version',
      ref: profile.id,
      status: pj.dpdpa?.noticeStatus ?? null,
      dueAt: null,
      createdAt: now,
      updatedAt: now,
      data: {
        profileId: profile.id,
        profileName: profile.name,
        profileVersion: profile.version,
        noticeVersion: pj.dpdpa?.noticeVersion ?? null,
        noticeStatus: pj.dpdpa?.noticeStatus ?? null,
        complianceGroup: pj.complianceGroup ?? null,
        regulation: pj.regulation ?? null,
        defaultLocale: profile.defaultLocale,
        contentHash: createHash('sha256').update(JSON.stringify(pj)).digest('hex'),
        change,
        actorId,
      },
    }
    await this.storage.putEntity(entry)
    return entry
  }

  async list(tenantId: string, profileId?: string, options: EntityListOptions = {}): Promise<NoticeVersion[]> {
    return await this.storage.listEntities(
      { tenantId, collection: 'notice_version', ...(profileId ? { ref: profileId } : {}) }, options,
    ) as unknown as NoticeVersion[]
  }

  count(tenantId: string, profileId?: string): Promise<number> {
    return this.storage.countEntities({ tenantId, collection: 'notice_version', ...(profileId ? { ref: profileId } : {}) })
  }
}
