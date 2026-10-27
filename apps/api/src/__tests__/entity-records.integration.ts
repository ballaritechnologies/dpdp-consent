/**
 * Generic entity-record store (schema v4): put / get / list / count / delete behave the same on
 * every driver, records never cross tenants, and a v3 SQLite database is upgraded in place.
 *
 * Runs on the JSON file store and both bundled SQLite drivers. PostgreSQL, MySQL and MongoDB run
 * too when a server is given: CONSENTI_TEST_PG_URL, CONSENTI_TEST_MYSQL_URL, CONSENTI_TEST_MONGO_URL.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { EntityRecord, StorageAdapter, StorageConfig } from '@consenti/types'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { NodeSqliteBuiltinAdapter } from '../storage/sqlite/node-sqlite-builtin.adapter.js'
import { NodeSqlite3WasmAdapter } from '../storage/sqlite/node-sqlite3-wasm.adapter.js'
import { PostgreSQLAdapter } from '../storage/postgresql/postgresql.adapter.js'
import { MySQLAdapter } from '../storage/mysql/mysql.adapter.js'
import { MongoDBAdapter } from '../storage/mongodb/mongodb.adapter.js'
import { SCHEMA_SQL_SQLITE, SEED_SQL } from '../storage/seed-data.js'

type Factory = (dir: string) => StorageAdapter
const DRIVERS: Array<[string, Factory]> = [
  ['json', dir => new JsonFileAdapter({ driver: 'json', path: dir })],
  ['node:sqlite', dir => new NodeSqliteBuiltinAdapter({ driver: 'node:sqlite', path: dir })],
  ['node-sqlite3-wasm', dir => new NodeSqlite3WasmAdapter({ driver: 'node-sqlite3-wasm', path: dir })],
]
const pg = process.env['CONSENTI_TEST_PG_URL']
const my = process.env['CONSENTI_TEST_MYSQL_URL']
const mongo = process.env['CONSENTI_TEST_MONGO_URL']
if (pg) DRIVERS.push(['postgresql', () => new PostgreSQLAdapter({ driver: 'postgresql', uri: pg } as StorageConfig)])
if (my) DRIVERS.push(['mysql', () => new MySQLAdapter({ driver: 'mysql', uri: my } as StorageConfig)])
if (mongo) DRIVERS.push(['mongodb', () => new MongoDBAdapter({ driver: 'mongodb', uri: mongo, database: `ijazat_test_${Date.now()}` })])

function rec(over: Partial<EntityRecord> = {}): EntityRecord {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), tenantId: 'default', collection: 'consent_receipt', ref: null, status: null,
    dueAt: null, createdAt: now, updatedAt: now, data: {}, ...over,
  }
}

for (const [name, make] of DRIVERS) describe(`entity records (${name})`, () => {
  let dir: string
  let s: StorageAdapter
  const run = randomUUID() // isolates runs that share a server database
  const ref = (x: string): string => `${run}:${x}`

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-entities-'))
    s = make(dir)
    await s.connect()
    await s.createTenant({ name: 'Other', slug: `other-${run.slice(0, 8)}` }).then(t => { otherTenant = t.id })
  })
  after(async () => {
    await s.deleteEntities({ tenantId: 'default', collection: 'consent_receipt' }).catch(() => 0)
    await s.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })
  let otherTenant = ''

  test('put then get round-trips every field, and a second put replaces', async () => {
    const r = rec({ ref: ref('a'), status: 'received', dueAt: '2030-01-01T00:00:00.000Z', data: { n: 1, nested: { ok: true }, list: ['x'] } })
    await s.putEntity(r)
    assert.deepEqual(await s.getEntity('default', 'consent_receipt', r.id), r)
    const changed = { ...r, status: 'completed', updatedAt: new Date(Date.now() + 1000).toISOString(), data: { n: 2 } }
    await s.putEntity(changed)
    assert.deepEqual(await s.getEntity('default', 'consent_receipt', r.id), changed)
    assert.equal(await s.getEntity('default', 'erasure_request', r.id), null, 'collection is part of the key')
  })

  test('list filters by ref, status, due and created time; orders newest first by default', async () => {
    const base = Date.parse('2031-01-01T00:00:00.000Z')
    const at = (d: number): string => new Date(base + d * 86_400_000).toISOString()
    const rs = [0, 1, 2, 3].map(d => rec({ ref: ref('list'), createdAt: at(d), updatedAt: at(d), status: d % 2 ? 'odd' : 'even', dueAt: d < 2 ? at(d + 10) : null }))
    for (const r of rs) await s.putEntity(r)
    const f = { tenantId: 'default', collection: 'consent_receipt' as const, ref: ref('list') }
    assert.deepEqual((await s.listEntities(f)).map(r => r.id), [...rs].reverse().map(r => r.id))
    assert.deepEqual((await s.listEntities(f, { order: 'asc', limit: 2, offset: 1 })).map(r => r.id), [rs[1]!.id, rs[2]!.id])
    assert.equal(await s.countEntities(f), 4)
    assert.equal(await s.countEntities({ ...f, status: 'odd' }), 2)
    assert.equal(await s.countEntities({ ...f, dueBefore: at(12) }), 2, 'records without a due date never match dueBefore')
    assert.equal(await s.countEntities({ ...f, dueBefore: at(10.5) }), 1)
    assert.equal(await s.countEntities({ ...f, createdBefore: at(2) }), 2)
    assert.equal(await s.countEntities({ ...f, createdFrom: at(2) }), 2)
    assert.equal(await s.deleteEntities({ ...f, createdBefore: at(2) }), 2)
    assert.equal(await s.countEntities(f), 2)
  })

  test('records never cross tenants', async () => {
    const r = rec({ ref: ref('tenant') })
    await s.putEntity(r)
    assert.equal(await s.getEntity(otherTenant, 'consent_receipt', r.id), null)
    assert.equal(await s.countEntities({ tenantId: otherTenant, collection: 'consent_receipt', ref: ref('tenant') }), 0)
    assert.equal(await s.deleteEntities({ tenantId: otherTenant, collection: 'consent_receipt' }), 0)
    // The same id put under another tenant must not overwrite the first tenant's record.
    await s.putEntity({ ...r, tenantId: otherTenant, data: { hijack: true } }).catch(() => undefined)
    assert.deepEqual((await s.getEntity('default', 'consent_receipt', r.id))?.data, {})
  })
})

describe('SQLite schema v3 → v4', () => {
  test('adds entity_records to an existing v3 database and keeps its data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ijazat-v4-'))
    try {
      mkdirSync(join(dir, 'db'), { recursive: true })
      const dbPath = join(dir, 'db', 'consenti.db')
      const db = new DatabaseSync(dbPath)
      // A v3 schema is the current one without the new table.
      db.exec(SCHEMA_SQL_SQLITE.replace(/CREATE TABLE IF NOT EXISTS entity_records[\s\S]*?\);\n/, '').replace(/CREATE INDEX IF NOT EXISTS idx_entity_records\w* ON entity_records \([^)]*\);\n?/g, ''))
      db.exec(SEED_SQL)
      db.exec("INSERT INTO profiles (id, tenant_id, name, profile_json) VALUES ('prof_keep', 'default', 'Keep', '{}'); PRAGMA user_version = 3;")
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'entity_records'").get()?.['n'], 0)
      db.close()

      const s = new NodeSqliteBuiltinAdapter({ driver: 'node:sqlite', path: dir })
      await s.connect()
      assert.ok(await s.getProfile('prof_keep'))
      const r = rec()
      await s.putEntity(r)
      assert.deepEqual(await s.getEntity('default', 'consent_receipt', r.id), r)
      await s.disconnect()

      const check = new DatabaseSync(dbPath)
      assert.equal(check.prepare('PRAGMA user_version').get()?.['user_version'], 4)
      check.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
