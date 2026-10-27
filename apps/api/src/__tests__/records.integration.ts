/**
 * Ijazat record-keeping: consent receipts, notice versions, the deletion-request inbox,
 * purpose-based retention and their admin routes and exports. Runs on the JSON file store with
 * the seeded DPDP profile.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CategoryMap, ConsentValue, Profile, ServerConsentReceipt } from '@consenti/types'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { ProfileRepo } from '../repositories/profile.repo.js'
import { ConsentRepo } from '../repositories/consent.repo.js'
import { VisitorRepo } from '../repositories/visitor.repo.js'
import { AuditRepo } from '../repositories/audit.repo.js'
import { ProfileService } from '../services/profile.service.js'
import { ConsentService } from '../services/consent.service.js'
import { ReceiptService } from '../services/receipt.service.js'
import { NoticeVersionService } from '../services/notice-version.service.js'
import { ErasureRequestService, ErasureRequestError } from '../services/erasure-request.service.js'
import { RetentionService, validateRetentionPolicy, RetentionPolicyError } from '../services/retention.service.js'
import { buildAdminRecordRoutes } from '../routes/admin/records.routes.js'
import { signJwt } from '../utils/crypto.js'
import { buildConsentRoutes } from '../routes/public/consent.routes.js'
import { buildOwnershipSetCookie } from '../utils/cookie.js'
import { VisitorService } from '../services/visitor.service.js'

const SECRET = 'records-test-secret'
const DAY = 86_400_000

describe('records', () => {
  let dir: string
  let storage: JsonFileAdapter
  let profiles: ProfileService
  let consents: ConsentService
  let receipts: ReceiptService
  let noticeVersions: NoticeVersionService
  let erasure: ErasureRequestService
  let retention: RetentionService
  let profile: Profile
  let categories: CategoryMap

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-records-'))
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
    const audit = new AuditRepo(storage)
    receipts = new ReceiptService(storage, SECRET)
    noticeVersions = new NoticeVersionService(storage)
    profiles = new ProfileService(new ProfileRepo(storage), audit, 'default', storage, undefined, undefined, join(dir, 'profiles'), undefined, undefined, noticeVersions)
    consents = new ConsentService(
      new ConsentRepo(storage), new VisitorRepo(storage), new ProfileRepo(storage), audit, 'default',
      undefined, undefined, undefined, undefined, storage, SECRET, undefined, undefined, receipts,
    )
    retention = new RetentionService(storage, () => consents, receipts, audit)
    erasure = new ErasureRequestService(storage, audit, id => receipts.visitorRef(id), (_t, id) => consents.erase(id), t => retention.getPolicy(t))
    await profiles.seedDefaultProfile('opt-in-dpdpa')
    profile = (await profiles.findActiveByComplianceGroup('opt-in-dpdpa'))!
    categories = profile.profileJson.preferenceModal!.categories!
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Every item of the given purposes granted, every other one denied. */
  function choose(granted: string[]): ConsentValue {
    const out: ConsentValue = {}
    for (const [id, cat] of Object.entries(categories)) for (const c of cat.cookies) out[c] = granted.includes(id) || id === 'necessary' ? 'granted' : 'denied'
    return out
  }

  async function give(visitorId: string, granted: string[]) {
    await storage.createVisitor({ tenantId: 'default', visitorId })
    return consents.create({ visitorId, profileId: profile.id, locale: 'hi', consentJson: choose(granted), gpcDetected: false, source: 'banner' })
  }

  // ── Receipts ───────────────────────────────────────────────────────────────

  test('every decision writes a signed receipt keyed by a hashed visitor ID', async () => {
    await give('visitor-a', ['analytics'])
    await consents.update('visitor-a', { consentJson: choose(['analytics', 'marketing']) })
    await consents.update('visitor-a', { consentJson: choose([]) })
    await consents.erase('visitor-a')

    const list = await receipts.forVisitor('default', 'visitor-a', { order: 'asc' })
    assert.deepEqual(list.map(r => r.data.action), ['given', 'updated', 'withdrawn', 'erased'])
    const [given] = list as [ServerConsentReceipt]
    assert.notEqual(given.ref, 'visitor-a')
    assert.doesNotMatch(JSON.stringify(list), /visitor-a/, 'the raw visitor ID is stored nowhere in a receipt')
    assert.equal(given.data.locale, 'hi')
    assert.equal(given.data.profileId, profile.id)
    assert.equal(given.data.complianceGroup, 'opt-in-dpdpa')
    assert.equal(given.data.purposes['analytics'], 'granted')
    assert.equal(given.data.purposes['marketing'], 'denied')
    assert.equal(given.data.purposes['necessary'], 'granted')
    for (const r of list) assert.equal(receipts.verify(r), true)

    const tampered = { ...given, data: { ...given.data, purposes: { ...given.data.purposes, marketing: 'granted' as const } } }
    assert.equal(receipts.verify(tampered), false)
    assert.equal(receipts.verify({ ...given, createdAt: new Date(0).toISOString() }), false)
  })

  test('erasure keeps only a digest in the audit log', async () => {
    await give('visitor-b', ['analytics'])
    await consents.erase('visitor-b')
    const logs = await storage.getLogs({ tenantId: 'default', page: 1, limit: 50 })
    const erased = logs.items.find(l => l.action === 'consent:erased')
    assert.ok(erased)
    const all: unknown[] = []
    for await (const l of storage.streamAuditLogs({ tenantId: 'default' })) if (l.action === 'consent:erased') all.push(l.oldData)
    assert.equal(all.length, 1)
    assert.ok(!('consentJson' in (all[0] as object)), 'no decisions in the erasure log entry')
  })

  // ── Notice versions ────────────────────────────────────────────────────────

  test('each profile save records a notice version with a content hash', async () => {
    const before = await noticeVersions.list('default', profile.id)
    assert.equal(before.length, 1)
    assert.equal(before[0]!.data.change, 'created')
    const pj = { ...profile.profileJson, dpdpa: { ...profile.profileJson.dpdpa!, noticeVersion: '2026-11', noticeStatus: 'reviewed' as const } }
    await profiles.update(profile.id, { profileJson: pj }, 'user-7')
    const after = await noticeVersions.list('default', profile.id)
    assert.equal(after.length, 2)
    const [latest, first] = after as [typeof after[0], typeof after[0]]
    assert.equal(latest!.data.profileVersion, profile.version + 1)
    assert.equal(latest!.data.noticeVersion, '2026-11')
    assert.equal(latest!.status, 'reviewed')
    assert.equal(latest!.data.actorId, 'user-7')
    assert.notEqual(latest!.data.contentHash, first!.data.contentHash)
    assert.match(latest!.data.contentHash, /^[0-9a-f]{64}$/)

    await give('visitor-n', ['analytics'])
    const [r] = await receipts.forVisitor('default', 'visitor-n')
    assert.equal(r!.data.noticeVersion, '2026-11', 'receipts carry the notice version shown')
  })

  // ── Erasure requests ───────────────────────────────────────────────────────

  test('erasure request lifecycle: due date, transitions, history, erasing the consent record', async () => {
    await give('visitor-c', ['marketing'])
    const req = await erasure.create({ tenantId: 'default', channel: 'widget', visitorId: 'visitor-c', contact: 'me@example.test' })
    assert.equal(req.status, 'received')
    assert.equal(Math.round((Date.parse(req.dueAt!) - Date.parse(req.createdAt)) / DAY), 30)

    await assert.rejects(erasure.transition('default', req.id, { status: 'rejected' }), (e: unknown) => e instanceof ErasureRequestError && e.status === 400)
    await erasure.transition('default', req.id, { status: 'verifying', actorId: 'u1', note: 'Asked for confirmation' })
    const done = await erasure.transition('default', req.id, { status: 'completed', actorId: 'u1', eraseConsent: true })
    assert.equal(done.data.consentErased, true)
    assert.equal(done.data.visitorId, null, 'raw visitor ID dropped once closed')
    assert.deepEqual(done.data.history.map(h => h.status), ['received', 'verifying', 'completed'])
    assert.equal(await consents.get('visitor-c'), null)
    await assert.rejects(erasure.transition('default', req.id, { status: 'in_progress' }), (e: unknown) => e instanceof ErasureRequestError && e.status === 409)
    assert.equal(await erasure.get('other-tenant', req.id), null)

    await assert.rejects(erasure.create({ tenantId: 'default', channel: 'email' }), /visitorId or a contact/)
    await assert.rejects(erasure.create({ tenantId: 'default', channel: 'email', contact: 'x'.repeat(300) }), /longer than/)
  })

  test('overdue lists open requests past their due date', async () => {
    await retention.setPolicy('default', { erasureResponseDays: 1 })
    const a = await erasure.create({ tenantId: 'default', channel: 'email', contact: 'a@example.test' })
    const b = await erasure.create({ tenantId: 'default', channel: 'email', contact: 'b@example.test' })
    await erasure.transition('default', b.id, { status: 'rejected', note: 'Duplicate' })
    assert.deepEqual((await erasure.overdue('default', new Date(Date.now() + 2 * DAY))).map(r => r.id), [a.id])
    assert.equal((await erasure.overdue('default')).length, 0)
  })

  // ── Retention ──────────────────────────────────────────────────────────────

  test('a purpose lapses after its expiry period, measured from when it was last switched on', async () => {
    await retention.setPolicy('default', { purposeExpiryDays: { analytics: 30, marketing: 90 } })
    await give('visitor-r', ['analytics', 'marketing'])
    const later = new Date(Date.now() + 31 * DAY)

    const dry = await retention.run('default', { dryRun: true, now: later })
    assert.equal(dry.expired.length, 1)
    assert.deepEqual(dry.expired[0]!.purposes, ['analytics'])
    assert.equal(dry.expired[0]!.visitorRef, receipts.visitorRef('visitor-r'))
    assert.equal((await consents.get('visitor-r'))!.consentJson[categories['analytics']!.cookies[0]!], 'granted', 'dry run changes nothing')

    const real = await retention.run('default', { now: later })
    assert.deepEqual(real.expired[0]!.purposes, ['analytics'])
    const record = (await consents.get('visitor-r'))!
    for (const c of categories['analytics']!.cookies) assert.equal(record.consentJson[c], 'denied')
    for (const c of categories['marketing']!.cookies) assert.equal(record.consentJson[c], 'granted')
    const [last] = await receipts.forVisitor('default', 'visitor-r')
    assert.equal(last!.data.action, 'expired')
    assert.deepEqual(last!.data.expiredPurposes, ['analytics'])

    assert.equal((await retention.run('default', { now: later })).expired.length, 0, 'nothing left to lapse')
    // Switching marketing off and on again restarts its clock.
    await consents.update('visitor-r', { consentJson: choose([]) })
    await consents.update('visitor-r', { consentJson: choose(['marketing']) })
    assert.equal((await retention.run('default', { dryRun: true, now: new Date(Date.now() + 89 * DAY) })).expired.length, 0)
    assert.equal((await retention.run('default', { dryRun: true, now: new Date(Date.now() + 91 * DAY) })).expired.length, 1)
  })

  test('old receipts and closed requests are deleted after their retention periods', async () => {
    await give('visitor-d', ['analytics'])
    const open = await erasure.create({ tenantId: 'default', channel: 'email', contact: 'open@example.test' })
    const closed = await erasure.create({ tenantId: 'default', channel: 'email', contact: 'closed@example.test' })
    await erasure.transition('default', closed.id, { status: 'completed' })
    await retention.setPolicy('default', { receiptDays: 365, closedErasureRequestDays: 180 })
    const later = new Date(Date.now() + 400 * DAY)
    const dry = await retention.run('default', { dryRun: true, now: later })
    assert.deepEqual([dry.receiptsDeleted, dry.erasureRequestsDeleted], [1, 1])
    await retention.run('default', { now: later })
    assert.equal(await receipts.count({ tenantId: 'default', collection: 'consent_receipt' }), 0)
    assert.ok(await erasure.get('default', open.id), 'open requests are never deleted')
    assert.equal(await erasure.get('default', closed.id), null)
  })

  test('policy validation', () => {
    assert.deepEqual(validateRetentionPolicy({ receiptDays: 10, junk: 1 }), { receiptDays: 10 })
    for (const bad of [null, [], { receiptDays: 0 }, { receiptDays: 1.5 }, { purposeExpiryDays: { 'a b': 3 } }, { purposeExpiryDays: { a: -1 } }]) {
      assert.throws(() => validateRetentionPolicy(bad), RetentionPolicyError, JSON.stringify(bad))
    }
  })

  // ── Admin routes ───────────────────────────────────────────────────────────

  function routes() {
    return buildAdminRecordRoutes(storage, { mode: 'jwt' }, SECRET, { receipts, noticeVersions, erasure, retention })
  }
  function jwt(permissions: string[], allowedTenants: string[] = []): string {
    return signJwt({ sub: 'admin-1', email: 'a@example.test', roles: [], permissions, allowedTenants }, SECRET)
  }
  async function call(key: string, path: string, opts: { body?: unknown; perms?: string[]; tenants?: string[]; params?: Record<string, string> } = {}) {
    const method = key.split(' ')[0]!
    const req = new Request(`http://localhost/consenti/admin/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${jwt(opts.perms ?? ['consent:view', 'settings:update', 'export:run'], opts.tenants)}`, 'content-type': 'application/json' },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
    const handler = (routes() as Record<string, (r: Request, p: Record<string, string>) => Promise<Response>>)[key]!
    return handler(req, opts.params ?? {})
  }

  test('admin: receipts list with filters, permissions and tenant checks', async () => {
    await give('visitor-e', ['analytics'])
    await give('visitor-f', [])
    let res = await call('GET /receipts', '/receipts?visitorId=visitor-e')
    assert.equal(res.status, 200)
    const body = await res.json() as { items: (ServerConsentReceipt & { verified: boolean })[]; total: number }
    assert.equal(body.total, 1)
    assert.equal(body.items[0]!.verified, true)
    res = await call('GET /receipts', '/receipts?action=bogus')
    assert.equal(res.status, 400)
    assert.equal((await call('GET /receipts', '/receipts', { perms: ['stats:view'] })).status, 403)
    assert.equal((await call('GET /receipts', '/receipts?tenantId=default', { tenants: ['site-b'] })).status, 403)
    assert.equal((await call('GET /receipts', '/receipts?tenantId=nope')).status, 404)
  })

  test('admin: erasure inbox create, update, overdue counters', async () => {
    let res = await call('POST /erasure-requests', '/erasure-requests', { body: { channel: 'email', contact: 'p@example.test', message: 'Please delete' } })
    assert.equal(res.status, 201)
    const created = await res.json() as { id: string }
    assert.equal((await call('POST /erasure-requests', '/erasure-requests', { body: { channel: 'fax', contact: 'x' } })).status, 400)
    assert.equal((await call('POST /erasure-requests', '/erasure-requests', { body: { contact: 'x' }, perms: ['consent:view'] })).status, 403)
    res = await call('PATCH /erasure-requests/:id', `/erasure-requests/${created.id}`, { params: { id: created.id }, body: { status: 'in_progress' } })
    assert.equal(res.status, 200)
    res = await call('PATCH /erasure-requests/:id', `/erasure-requests/${created.id}`, { params: { id: created.id }, body: { status: 'received' } })
    assert.equal(res.status, 409)
    res = await call('GET /erasure-requests', '/erasure-requests')
    const list = await res.json() as { total: number; open: number; overdue: number }
    assert.deepEqual([list.total, list.open, list.overdue], [1, 1, 0])
  })

  test('admin: retention policy and run (dry run unless asked otherwise)', async () => {
    assert.equal((await call('PUT /retention/policy', '/retention/policy', { body: { receiptDays: -3 } })).status, 400)
    assert.equal((await call('PUT /retention/policy', '/retention/policy', { body: { receiptDays: 30 } })).status, 200)
    assert.deepEqual(await (await call('GET /retention/policy', '/retention/policy')).json(), { receiptDays: 30 })
    const run = await (await call('POST /retention/run', '/retention/run', { body: {} })).json() as { dryRun: boolean }
    assert.equal(run.dryRun, true)
  })

  test('admin: CSV and JSON exports, with spreadsheet formulas neutralised', async () => {
    await give('visitor-g', ['analytics'])
    await erasure.create({ tenantId: 'default', channel: 'email', contact: '=HYPERLINK("http://evil")', message: 'a,b\nc' })

    let res = await call('GET /export/receipts', '/export/receipts')
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8')
    const csv = await res.text()
    assert.match(csv, /^id,created_at,visitor_ref,action,/)
    assert.equal(csv.trim().split('\n').length, 2)

    res = await call('GET /export/receipts', '/export/receipts?format=json')
    const json = await res.json() as ServerConsentReceipt[]
    assert.equal(json.length, 1)
    assert.equal(json[0]!.data.action, 'given')

    const erq = await (await call('GET /export/erasure-requests', '/export/erasure-requests')).text()
    assert.match(erq, /'=HYPERLINK/)
    assert.match(erq, /"a,b\nc"/)

    const ntv = await (await call('GET /export/notice-versions', '/export/notice-versions?format=json')).json() as unknown[]
    assert.equal(ntv.length, 1)
    assert.equal((await call('GET /export/receipts', '/export/receipts?format=xml')).status, 400)
    assert.equal((await call('GET /export/receipts', '/export/receipts', { perms: ['consent:view'] })).status, 403)
  })

  test('public: a visitor can open an erasure request for their own visitor ID only', async () => {
    const rec = await give('visitor-p', ['analytics'])
    const pub = buildConsentRoutes(consents, new VisitorService(new VisitorRepo(storage), 'default', undefined, SECRET), profiles,
      async () => 'default', storage, SECRET, undefined, 7, erasure)
    const cookie = buildOwnershipSetCookie('visitor-p', rec.id, SECRET).split(';')[0]!
    const post = (headers: Record<string, string>, body: unknown) => pub['POST /consent/:visitorId/erasure-request'](
      new Request('http://localhost/consenti/api/v1/consent/visitor-p/erasure-request', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
      { visitorId: 'visitor-p' })
    assert.equal((await post({}, {})).status, 403)
    const res = await post({ cookie }, { contact: 'p@example.test', message: 'Delete my data' })
    assert.equal(res.status, 201)
    const body = await res.json() as { id: string; status: string; dueAt: string }
    assert.equal(body.status, 'received')
    const stored = await erasure.get('default', body.id)
    assert.equal(stored!.data.channel, 'widget')
    assert.equal(stored!.ref, receipts.visitorRef('visitor-p'))
    assert.equal((await post({ cookie }, { message: 'x'.repeat(3000) })).status, 400)
  })
})
