/**
 * Consent-record storage, the same on every driver: an update can move a record to another
 * profile, and a visitor with more than one record (legacy data) reads and updates their most
 * recently updated one, leaving the others untouched.
 *
 * Runs on the JSON file store and both bundled SQLite drivers. PostgreSQL, MySQL and MongoDB run
 * too when a server is given: CONSENTI_TEST_PG_URL, CONSENTI_TEST_MYSQL_URL, CONSENTI_TEST_MONGO_URL.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { CreateConsentInput, StorageAdapter, StorageConfig } from '@consenti/types'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { NodeSqliteBuiltinAdapter } from '../storage/sqlite/node-sqlite-builtin.adapter.js'
import { NodeSqlite3WasmAdapter } from '../storage/sqlite/node-sqlite3-wasm.adapter.js'
import { PostgreSQLAdapter } from '../storage/postgresql/postgresql.adapter.js'
import { MySQLAdapter } from '../storage/mysql/mysql.adapter.js'
import { MongoDBAdapter } from '../storage/mongodb/mongodb.adapter.js'

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

for (const [name, make] of DRIVERS) describe(`consent records (${name})`, () => {
  let dir: string
  let s: StorageAdapter
  const run = randomUUID().slice(0, 8) // isolates runs that share a server database
  const visitors: string[] = []
  const input = (visitorId: string, profileId: string): CreateConsentInput => {
    visitors.push(visitorId)
    return { tenantId: 'default', visitorId, profileId, locale: 'en', consentJson: { a: 'granted' }, gpcDetected: false, source: 'banner' }
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-consents-'))
    s = make(dir)
    await s.connect()
  })
  after(async () => {
    for (const v of visitors) await s.deleteConsent(v).catch(() => undefined)
    await s.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  test('an update can move the record to another profile', async () => {
    const v = `${run}-move`
    const created = await s.createConsent(input(v, 'prof_a'))
    const updated = await s.updateConsent(v, { consentJson: { b: 'denied' }, profileId: 'prof_b', profileVersion: 2 })
    assert.equal(updated.id, created.id)
    assert.equal(updated.profileId, 'prof_b')
    assert.equal(updated.profileVersion, 2)
    assert.equal((await s.getConsent(v))?.profileId, 'prof_b')
    assert.equal((await s.getConsentHistory(v)).length, 2)
  })

  test('free-text search works on the consents, visitors and audit-log lists', async () => {
    const v = `${run}-search_%`
    await s.createConsent(input(v, 'prof_a'))
    const found = await s.getConsents({ tenantId: 'default', q: v, page: 1, limit: 10 })
    assert.deepEqual(found.items.map(i => i.visitorId), [v], 'LIKE wildcards in the search are literal')
    await s.getVisitors({ tenantId: 'default', q: v, page: 1, limit: 10 })
    await s.getLogs({ tenantId: 'default', q: 'consent%', page: 1, limit: 10 })
  })

  test('a visitor with two records reads and updates the newest only', async () => {
    const v = `${run}-dup`
    const older = await s.createConsent(input(v, 'prof_a'))
    await sleep(1100) // MySQL and SQLite timestamps may have one-second precision
    const newer = await s.createConsent(input(v, 'prof_b'))
    assert.equal((await s.getConsent(v))?.id, newer.id)

    const updated = await s.updateConsent(v, { consentJson: { a: 'denied' } })
    assert.equal(updated.id, newer.id)
    assert.deepEqual(updated.consentJson, { a: 'denied' })
    // The older record is untouched.
    const page = await s.getConsents({ tenantId: 'default', profileId: 'prof_a', q: v, page: 1, limit: 10 })
    assert.equal(page.items.find(i => i.id === older.id)?.id, older.id)
    assert.equal((await s.getConsent(v))?.id, newer.id)
  })
})
