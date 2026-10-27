/**
 * Phase 9: the `strictest_global` regime's server-side GPC handling, and Consent Manager
 * notifications through an adapter (the mock).
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { CategoryMap, ConsentManagerEvent, ConsentValue, CookieMap, Profile } from '@consenti/types'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { ProfileRepo } from '../repositories/profile.repo.js'
import { ConsentRepo } from '../repositories/consent.repo.js'
import { VisitorRepo } from '../repositories/visitor.repo.js'
import { AuditRepo } from '../repositories/audit.repo.js'
import { ProfileService } from '../services/profile.service.js'
import { ConsentService } from '../services/consent.service.js'
import { ReceiptService } from '../services/receipt.service.js'
import { ConsentManagerService, consentFromArtefact, validateConsentManagerEvent } from '../services/consent-manager.service.js'
import { MockConsentManager } from '../consent-manager/mock-adapter.js'
import { buildConsentManagerRoutes } from '../routes/public/consent-manager.routes.js'

const SECRET = 'phase9-secret'

describe('strictest_global and Consent Managers', () => {
  let dir: string
  let storage: JsonFileAdapter
  let consents: ConsentService
  let receipts: ReceiptService
  let profiles: ProfileService
  let profile: Profile
  let categories: CategoryMap
  let cookies: CookieMap
  let cms: ConsentManagerService
  let mock: MockConsentManager
  let bus: EventEmitter

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-phase9-'))
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
    const audit = new AuditRepo(storage)
    receipts = new ReceiptService(storage, SECRET)
    profiles = new ProfileService(new ProfileRepo(storage), audit, 'default', storage, undefined, undefined, join(dir, 'profiles'))
    consents = new ConsentService(
      new ConsentRepo(storage), new VisitorRepo(storage), new ProfileRepo(storage), audit, 'default',
      undefined, undefined, undefined, undefined, storage, SECRET, undefined, undefined, receipts,
    )
    await profiles.seedDefaultProfile('opt-in-dpdpa')
    profile = (await profiles.findActiveByComplianceGroup('opt-in-dpdpa'))!
    categories = profile.profileJson.preferenceModal!.categories!
    cookies = profile.profileJson.cookies!
    mock = new MockConsentManager({ secret: 'cm-secret' })
    bus = new EventEmitter()
    cms = new ConsentManagerService(storage, audit, receipts, async () => ({ profile, categories: (await consents.purposesFor(profile.id))! }), [mock], bus)
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const everything = (): ConsentValue => Object.fromEntries(Object.keys(cookies).map(c => [c, 'granted'])) as ConsentValue
  const adItems = () => Object.entries(cookies).filter(([, c]) => c.purpose === 'marketing').map(([id]) => id)

  test('strictest_global: GPC refuses advertising on the DPDP flow; other regimes ignore GPC there', async () => {
    await storage.createVisitor({ tenantId: 'default', visitorId: 'v-gpc' })
    let rec = await consents.create({ visitorId: 'v-gpc', profileId: profile.id, locale: 'en', consentJson: everything(), gpcDetected: true, source: 'banner' })
    for (const id of adItems()) assert.equal(rec.consentJson[id], 'granted', 'DPDP alone ignores GPC')

    await storage.updateSettings('default', { regime: 'strictest_global' })
    rec = await consents.update('v-gpc', { consentJson: everything() })
    for (const id of adItems()) assert.equal(rec.consentJson[id], 'denied', `${id} refused under GPC`)
    assert.equal(rec.consentJson['analytics_storage'], 'granted', 'only advertising follows GPC')

    await storage.createVisitor({ tenantId: 'default', visitorId: 'v-nogpc' })
    rec = await consents.create({ visitorId: 'v-nogpc', profileId: profile.id, locale: 'en', consentJson: everything(), gpcDetected: false, source: 'banner' })
    for (const id of adItems()) assert.equal(rec.consentJson[id], 'granted', 'no GPC, no change')
  })

  const event = (type: ConsentManagerEvent['type'], status: 'active' | 'withdrawn' | 'expired', purposes: { id: string; status: 'granted' | 'denied' }[]): ConsentManagerEvent => ({
    type, artefact: { artefactId: 'art-1', principalRef: 'cm-person-42', purposes, status, givenAt: new Date().toISOString(), noticeVersion: '2026-11' },
  })

  test('a Consent Manager grant, update and withdrawal are recorded with receipts and events', async () => {
    const seen: unknown[] = []
    bus.on('consent_manager:event', e => seen.push(e))
    const routes = buildConsentManagerRoutes(cms, async () => 'default')
    const post = (n: { headers: Record<string, string>; body: string }, adapter = 'mock') =>
      routes['POST /consent-managers/:adapterId/notify'](new Request(`http://localhost/consenti/api/v1/consent-managers/${adapter}/notify`, { method: 'POST', headers: n.headers, body: n.body }), { adapterId: adapter })

    const grant = mock.notification(event('consent.granted', 'active', [{ id: 'analytics', status: 'granted' }, { id: 'marketing', status: 'denied' }]))
    let res = await post(grant)
    assert.equal(res.status, 200)
    res = await post(grant)
    assert.equal(res.status, 200, 'a retried notification is accepted')
    await post(mock.notification(event('consent.withdrawn', 'withdrawn', [])))

    const { items } = await cms.list('default', undefined)
    assert.equal(items.length, 1)
    assert.equal(items[0]!.status, 'withdrawn')
    assert.deepEqual(items[0]!.data.history.map(h => h.type), ['consent.granted', 'consent.withdrawn'])
    assert.doesNotMatch(JSON.stringify(items[0]!.ref), /cm-person-42/)

    const rs = await receipts.forVisitor('default', 'cm:mock:cm-person-42', { order: 'asc' })
    assert.deepEqual(rs.map(r => r.data.action), ['given', 'withdrawn'])
    assert.equal(rs[0]!.data.source, 'consent_manager:mock')
    assert.equal(rs[0]!.data.noticeVersion, '2026-11')
    assert.equal(rs[0]!.data.purposes['analytics'], 'granted')
    assert.equal(rs[0]!.data.purposes['marketing'], 'denied')
    assert.equal(rs[1]!.data.purposes['analytics'], 'denied')
    assert.equal(rs[1]!.data.purposes['necessary'], 'granted')
    for (const r of rs) assert.equal(receipts.verify(r), true)
    assert.equal(seen.length, 2)
  })

  test('unverifiable, unknown or malformed notifications are rejected', async () => {
    const routes = buildConsentManagerRoutes(cms, async () => 'default')
    const call = (adapter: string, headers: Record<string, string>, body: string) =>
      routes['POST /consent-managers/:adapterId/notify'](new Request('http://localhost/x', { method: 'POST', headers, body }), { adapterId: adapter })
    const good = mock.notification(event('consent.granted', 'active', [{ id: 'analytics', status: 'granted' }]))
    assert.equal((await call('mock', { ...good.headers, 'x-mock-cm-signature': '00'.repeat(32) }, good.body)).status, 401)
    assert.equal((await call('other', good.headers, good.body)).status, 404)
    const malformed = mock.notification({ type: 'consent.granted', artefact: { artefactId: '', principalRef: 'p', purposes: [], status: 'active', givenAt: 'soon' } } as never)
    assert.equal((await call('mock', malformed.headers, malformed.body)).status, 400)
    assert.equal((await call('mock', good.headers, 'x'.repeat(70_000))).status, 413)
  })

  test('helpers: validation and purpose mapping', () => {
    assert.throws(() => validateConsentManagerEvent({ type: 'consent.deleted', artefact: {} }), /type/)
    const consent = consentFromArtefact({ artefactId: 'a', principalRef: 'p', purposes: [{ id: 'functional', status: 'granted' }, { id: 'unknown', status: 'granted' }], status: 'active', givenAt: new Date().toISOString() }, categories)
    for (const c of categories['functional']!.cookies) assert.equal(consent[c], 'granted')
    for (const c of categories['marketing']!.cookies) assert.equal(consent[c], 'denied')
    for (const c of categories['necessary']!.cookies) assert.equal(consent[c], 'granted')
    assert.throws(() => new ConsentManagerService(storage, new AuditRepo(storage), receipts, async () => null, [mock, mock]), /unique/)
  })
})
