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

  test('visitor-keyed reads, updates and deletes stay on the site they name', async () => {
    const other = (await s.createTenant({ name: 'Other', slug: `other-${run}` })).id
    const v = `${run}-site`
    await s.createConsent(input(v, 'prof_a'))
    await s.createVisitor({ tenantId: 'default', visitorId: v })
    await s.createNoticeShown({ tenantId: 'default', visitorId: v, profileId: 'prof_a', locale: 'en' })

    // Seen without a site, and on its own site; not on another.
    assert.ok(await s.getConsent(v))
    assert.ok(await s.getConsent(v, 'default'))
    assert.equal(await s.getConsent(v, other), null)
    assert.equal((await s.getVisitor(v, 'default'))?.visitorId, v)
    assert.equal(await s.getVisitor(v, other), null)
    assert.equal((await s.getConsentHistory(v, 'default')).length, 1)
    assert.deepEqual(await s.getConsentHistory(v, other), [])
    assert.equal((await s.getNoticeShownForVisitor(v, 'default')).length, 1)
    assert.deepEqual(await s.getNoticeShownForVisitor(v, other), [])

    // Changes through another site fail or do nothing.
    await assert.rejects(s.updateConsent(v, { consentJson: { a: 'denied' } }, other))
    await assert.rejects(s.updateVisitor(v, { country: 'IN' }, other))
    await s.deleteConsent(v, other)
    await s.deleteVisitor(v, other)
    assert.deepEqual((await s.getConsent(v, 'default'))?.consentJson, { a: 'granted' })
    assert.ok(await s.getVisitor(v, 'default'))

    // Through its own site they work.
    assert.deepEqual((await s.updateConsent(v, { consentJson: { a: 'denied' } }, 'default')).consentJson, { a: 'denied' })
    assert.equal((await s.updateVisitor(v, { country: 'IN' }, 'default')).country, 'IN')
    await s.deleteConsent(v, 'default')
    await s.deleteVisitor(v, 'default')
    assert.equal(await s.getConsent(v), null)
    assert.equal(await s.getVisitor(v), null)
  })

  test('deleting a site removes everything stored for it, and nothing of other sites', async () => {
    const site = (await s.createTenant({ name: 'Doomed', slug: `doomed-${run}` })).id
    const v = `${run}-doomed`
    const keep = `${run}-keep`
    for (const [tenantId, visitorId] of [[site, v], ['default', keep]] as const) {
      visitors.push(visitorId)
      await s.createConsent({ tenantId, visitorId, profileId: 'prof_a', locale: 'en', consentJson: { a: 'granted' }, gpcDetected: false, source: 'banner' })
      await s.updateConsent(visitorId, { consentJson: { a: 'denied' } }, tenantId)
      await s.createVisitor({ tenantId, visitorId })
      await s.createNoticeShown({ tenantId, visitorId, profileId: 'prof_a', locale: 'en' })
      await s.putEntity({ id: `rcpt-${visitorId}`, tenantId, collection: 'consent_receipt', ref: visitorId, status: 'given', dueAt: null, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', data: {} })
      await s.createLog({ tenantId, action: 'test.marker', resourceType: 'test', resourceId: visitorId })
    }
    await s.createApiKey({ tenantId: site, name: 'k', keyHash: `hash-${run}`, createdBy: 'test' })
    await s.createConsentTemplate({ tenantId: site, name: 't', cookies: {}, categories: {} })
    await s.updateSettings(site, { setupCompleted: true })

    await s.deleteTenant(site)

    assert.equal((await s.getTenants()).some(t => t.id === site), false)
    assert.equal(await s.getConsent(v), null)
    assert.deepEqual(await s.getConsentHistory(v), [])
    assert.equal(await s.getVisitor(v), null)
    assert.deepEqual(await s.getNoticeShownForVisitor(v), [])
    assert.equal(await s.countEntities({ tenantId: site, collection: 'consent_receipt' }), 0)
    assert.equal((await s.getLogs({ tenantId: site, page: 1, limit: 10 })).total, 0)
    assert.deepEqual(await s.getApiKeys(site), [])
    assert.deepEqual(await s.getConsentTemplates(site), [])
    assert.notEqual((await s.getSettings(site)).setupCompleted, true)
    // The default site is untouched.
    assert.ok(await s.getConsent(keep))
    assert.equal((await s.getConsentHistory(keep)).length, 2)
    assert.ok(await s.getVisitor(keep))
    assert.equal((await s.getNoticeShownForVisitor(keep)).length, 1)
    assert.equal(await s.countEntities({ tenantId: 'default', collection: 'consent_receipt', ref: keep }), 1)
    await s.deleteEntities({ tenantId: 'default', collection: 'consent_receipt', ref: keep }).catch(() => 0)
    await s.deleteVisitor(keep).catch(() => undefined)
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
