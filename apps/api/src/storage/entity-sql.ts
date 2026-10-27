// Shared SQL for the generic `entity_records` table (see seed-data.ts), used by the SQLite,
// PostgreSQL and MySQL adapters. Each adapter only supplies its placeholder style and runs the
// statements with its own driver.

import { randomUUID } from 'node:crypto'
import type { EntityRecord, EntityFilter, EntityListOptions, EntityCollection } from '@consenti/types'

export interface EntityRow {
  id: string
  tenant_id: string
  collection: string
  ref: string | null
  status: string | null
  due_at: string | null
  created_at: string
  updated_at: string
  data_json: string
}

export type SqlParam = string | number | null

/** `?` for SQLite/MySQL, `$n` for PostgreSQL. */
export type Placeholder = (index: number) => string

export const qmark: Placeholder = () => '?'
export const dollar: Placeholder = i => `$${i}`

const COLS = ['id', 'tenant_id', 'collection', 'ref', 'status', 'due_at', 'created_at', 'updated_at', 'data_json'] as const
const UPDATABLE = ['ref', 'status', 'due_at', 'updated_at', 'data_json'] as const

export const MAX_ENTITY_PAGE = 1000

export function rowToEntity(r: EntityRow): EntityRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    collection: r.collection as EntityCollection,
    ref: r.ref ?? null,
    status: r.status ?? null,
    dueAt: r.due_at ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    data: typeof r.data_json === 'string' ? JSON.parse(r.data_json) as Record<string, unknown> : (r.data_json as Record<string, unknown>),
  }
}

function rowParams(rec: EntityRecord): SqlParam[] {
  return [rec.id, rec.tenantId, rec.collection, rec.ref, rec.status, rec.dueAt, rec.createdAt, rec.updatedAt, JSON.stringify(rec.data)]
}

/**
 * Upsert by id. The update only applies when the existing row belongs to the same tenant, so a
 * colliding id can never move or overwrite another tenant's record.
 */
export function entityUpsert(table: string, dialect: 'sqlite' | 'postgres' | 'mysql', rec: EntityRecord): { sql: string; params: SqlParam[] } {
  const ph = dialect === 'postgres' ? dollar : qmark
  const values = COLS.map((_, i) => ph(i + 1)).join(', ')
  const insert = `INSERT INTO ${table} (${COLS.join(', ')}) VALUES (${values})`
  if (dialect === 'mysql') {
    const set = UPDATABLE.map(c => `${c} = IF(tenant_id = VALUES(tenant_id), VALUES(${c}), ${c})`).join(', ')
    return { sql: `${insert} ON DUPLICATE KEY UPDATE ${set}`, params: rowParams(rec) }
  }
  const set = UPDATABLE.map(c => `${c} = excluded.${c}`).join(', ')
  return { sql: `${insert} ON CONFLICT (id) DO UPDATE SET ${set} WHERE ${table}.tenant_id = excluded.tenant_id`, params: rowParams(rec) }
}

export function entityWhere(f: EntityFilter, ph: Placeholder, startIndex = 1): { sql: string; params: SqlParam[] } {
  const clauses: string[] = []
  const params: SqlParam[] = []
  const add = (clause: string, value: SqlParam): void => {
    params.push(value)
    clauses.push(clause.replace('?', ph(startIndex + params.length - 1)))
  }
  add('tenant_id = ?', f.tenantId)
  add('collection = ?', f.collection)
  if (f.ref !== undefined) add('ref = ?', f.ref)
  if (f.status !== undefined) add('status = ?', f.status)
  if (f.dueBefore !== undefined) add('due_at < ?', f.dueBefore)
  if (f.createdBefore !== undefined) add('created_at < ?', f.createdBefore)
  if (f.createdFrom !== undefined) add('created_at >= ?', f.createdFrom)
  return { sql: clauses.join(' AND '), params }
}

export function entitySelect(table: string, f: EntityFilter, ph: Placeholder, opts: EntityListOptions = {}): { sql: string; params: SqlParam[] } {
  const where = entityWhere(f, ph)
  const dir = opts.order === 'asc' ? 'ASC' : 'DESC'
  const limit = clampLimit(opts.limit)
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const n = where.params.length
  return {
    sql: `SELECT * FROM ${table} WHERE ${where.sql} ORDER BY created_at ${dir}, id ${dir} LIMIT ${ph(n + 1)} OFFSET ${ph(n + 2)}`,
    params: [...where.params, limit, offset],
  }
}

export function clampLimit(limit: number | undefined): number {
  return Math.min(MAX_ENTITY_PAGE, Math.max(1, Math.floor(limit ?? 50)))
}

/** In-memory equivalent of `entityWhere`, for the JSON file and MongoDB-less paths. */
export function matchesEntity(r: EntityRecord, f: EntityFilter): boolean {
  if (r.tenantId !== f.tenantId || r.collection !== f.collection) return false
  if (f.ref !== undefined && r.ref !== f.ref) return false
  if (f.status !== undefined && r.status !== f.status) return false
  if (f.dueBefore !== undefined && !(r.dueAt !== null && r.dueAt < f.dueBefore)) return false
  if (f.createdBefore !== undefined && !(r.createdAt < f.createdBefore)) return false
  if (f.createdFrom !== undefined && !(r.createdAt >= f.createdFrom)) return false
  return true
}

/** Comparator matching `entitySelect`'s ORDER BY. */
export function compareEntities(order: 'asc' | 'desc' = 'desc'): (a: EntityRecord, b: EntityRecord) => number {
  const sign = order === 'asc' ? 1 : -1
  return (a, b) => sign * (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1)
}

let lastMs = 0
let seq = 0

/**
 * `<prefix>_<ms><seq>_<random>`: sorts by creation time, and records made in the same millisecond
 * by this process sort in the order they were made (the list order's tie-breaker is the id).
 */
export function sortableEntityId(prefix: string, now = Date.now()): string {
  if (now === lastMs) seq++
  else { lastMs = now; seq = 0 }
  return `${prefix}_${now.toString(36).padStart(9, '0')}${seq.toString(36).padStart(4, '0')}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}
