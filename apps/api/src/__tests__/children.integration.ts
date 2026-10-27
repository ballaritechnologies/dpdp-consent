/**
 * Children's data (Phase 6): minors get no optional purposes until a parent's consent is verified
 * and never the blocked ones; parental-consent requests through a provider (the mock), the signed
 * token, or the dashboard; DPDP age threshold validation.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CategoryMap, ConsentValue, CookieMap, Profile } from '@consenti/types'
import { restrictConsentForMinor, purposesBlockedForMinors } from '@consenti/utils'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { ProfileRepo } from '../repositories/profile.repo.js'
import { ConsentRepo } from '../repositories/consent.repo.js'
import { VisitorRepo } from '../repositories/visitor.repo.js'
import { AuditRepo } from '../repositories/audit.repo.js'
import { ProfileService } from '../services/profile.service.js'
import { ConsentService } from '../services/consent.service.js'
import { ReceiptService } from '../services/receipt.service.js'
import { ParentalConsentService, ParentalConsentError } from '../services/parental-consent.service.js'
import { VisitorService } from '../services/visitor.service.js'
import { MockParentalConsentProvider } from '../parental-consent/mock-provider.js'
import { buildConsentRoutes } from '../routes/public/consent.routes.js'
import { buildAdminRecordRoutes } from '../routes/admin/records.routes.js'
import { buildOwnershipSetCookie } from '../utils/cookie.js'
import { buildParentalConsentToken } from '../utils/parental-consent-token.js'
import { signJwt } from '../utils/crypto.js'
import { findAgeGateProblem } from '../validators/dpdpa.validator.js'
import { NoticeVersionService } from '../services/notice-version.service.js'
import { ErasureRequestService } from '../services/erasure-request.service.js'
import { RetentionService } from '../services/retention.service.js'

const SECRET = 'children-test-secret'

describe('restrictConsentForMinor', () => {
  const categories = {
    necessary: { legalBasis: 'mandatory', cookies: ['sess'] },
    functional: { legalBasis: 'consent', cookies: ['chat'] },
    analytics: { legalBasis: 'consent', cookies: ['ga'] },
    ads: { legalBasis: 'consent', cookies: ['px'] },
  } as const
  const items = { sess: { purpose: 'necessary' }, chat: { purpose: 'functional' }, ga: { purpose: 'analytics' }, px: { purpose: 'marketing' }, loose: { purpose: 'marketing' } }
  const all = { sess: 'granted', chat: 'granted', ga: 'granted', px: 'granted', loose: 'granted' } as const
  const cats = categories as unknown as Record<string, { legalBasis: 'mandatory' | 'consent'; cookies: string[] }>

  test('pending parental consent: only mandatory items stay granted', () => {
    const r = restrictConsentForMinor({ ...all }, cats, items, false)
    assert.deepEqual(r.consent, { sess: 'granted', chat: 'denied', ga: 'denied', px: 'denied', loose: 'denied' })
    assert.deepEqual(r.changed.sort(), ['chat', 'ga', 'loose', 'px'])
  })

  test('verified: analytics and marketing items stay blocked by default', () => {
    assert.deepEqual(purposesBlockedForMinors(cats, items), ['analytics', 'ads'])
    const r = restrictConsentForMinor({ ...all }, cats, items, true)
    assert.deepEqual(r.consent, { sess: 'granted', chat: 'granted', ga: 'denied', px: 'denied', loose: 'denied' })
  })

  test('an explicit blockedPurposes list replaces the default', () => {
    const r = restrictConsentForMinor({ ...all }, cats, items, true, ['ads'])
    assert.deepEqual(r.consent, { sess: 'granted', chat: 'granted', ga: 'granted', px: 'denied', loose: 'granted' })
    assert.deepEqual(purposesBlockedForMinors(cats, items, ['ads', 'necessary']), ['ads'], 'mandatory categories are never blocked')
  })
})

describe('age gate validation', () => {
  test('a DPDP profile cannot set the age below 18', () => {
    assert.match(findAgeGateProblem({ complianceGroup: 'opt-in-dpdpa', ageGate: { enabled: true, minimumAge: 13 } })!, /at least 18/)
    assert.equal(findAgeGateProblem({ complianceGroup: 'opt-in-dpdpa', ageGate: { enabled: true, minimumAge: 18, requireParentalConsent: true } }), null)
    assert.equal(findAgeGateProblem({ complianceGroup: 'opt-in-dpdpa', ageGate: { enabled: false, minimumAge: 13 } }), null)
    assert.equal(findAgeGateProblem({ complianceGroup: 'opt-in', ageGate: { enabled: true, minimumAge: 16 } }), null)
    assert.match(findAgeGateProblem({ ageGate: { enabled: true, minimumAge: '18' } })!, /whole number/)
    assert.match(findAgeGateProblem({ ageGate: { enabled: 'yes', minimumAge: 18 } })!, /enabled/)
  })
})

describe('mock provider', () => {
  test('refuses to run in production unless allowed', () => {
    const prev = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    try {
      assert.throws(() => new MockParentalConsentProvider(), /must not be used in production/)
      assert.ok(new MockParentalConsentProvider({ allowInProduction: true }))
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev
    }
  })
})

describe('children: server enforcement and parental consent', () => {
  let dir: string
  let storage: JsonFileAdapter
  let consents: ConsentService
  let receipts: ReceiptService
  let parental: ParentalConsentService
  let provider: MockParentalConsentProvider
  let profiles: ProfileService
  let profile: Profile
  let categories: CategoryMap
  let cookies: CookieMap

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-children-'))
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
    const audit = new AuditRepo(storage)
    receipts = new ReceiptService(storage, SECRET)
    provider = new MockParentalConsentProvider()
    parental = new ParentalConsentService(storage, audit, id => receipts.visitorRef(id), provider)
    profiles = new ProfileService(new ProfileRepo(storage), audit, 'default', storage, undefined, undefined, join(dir, 'profiles'))
    consents = new ConsentService(
      new ConsentRepo(storage), new VisitorRepo(storage), new ProfileRepo(storage), audit, 'default',
      undefined, undefined, undefined, undefined, storage, SECRET, undefined, undefined, receipts, parental,
    )
    await profiles.seedDefaultProfile('opt-in-dpdpa')
    profile = (await profiles.findActiveByComplianceGroup('opt-in-dpdpa'))!
    categories = profile.profileJson.preferenceModal!.categories!
    cookies = profile.profileJson.cookies!
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const everything = (): ConsentValue => Object.fromEntries(Object.keys(cookies).map(c => [c, 'granted'])) as ConsentValue
  const stateOf = (consent: ConsentValue, category: string) => categories[category]!.cookies.map(c => consent[c])

  test('a minor gets nothing optional until a parent consents, and never analytics or ads', async () => {
    await storage.createVisitor({ tenantId: 'default', visitorId: 'kid' })
    let rec = await consents.create({ visitorId: 'kid', profileId: profile.id, locale: 'en', consentJson: everything(), gpcDetected: false, source: 'banner', ageVerified: false })
    for (const cat of ['functional', 'preferences', 'analytics', 'marketing']) assert.deepEqual(new Set(stateOf(rec.consentJson, cat)), new Set(['denied']), cat)
    assert.deepEqual(new Set(stateOf(rec.consentJson, 'necessary')), new Set(['granted']))
    let [receipt] = await receipts.forVisitor('default', 'kid')
    assert.equal(receipt!.data.minor, 'parental_consent_pending')

    const req = await parental.request('default', 'kid', profile.id, 'en')
    assert.equal(req.status, 'pending')
    provider.approve(req.data.providerRef!)
    assert.equal(await parental.isParentVerified('default', 'kid'), true)

    rec = await consents.update('kid', { consentJson: everything() })
    assert.deepEqual(new Set(stateOf(rec.consentJson, 'functional')), new Set(['granted']))
    assert.deepEqual(new Set(stateOf(rec.consentJson, 'analytics')), new Set(['denied']))
    assert.deepEqual(new Set(stateOf(rec.consentJson, 'marketing')), new Set(['denied']))
    ;[receipt] = await receipts.forVisitor('default', 'kid')
    assert.equal(receipt!.data.minor, 'parental_consent_verified')
  })

  test('adults are unaffected', async () => {
    await storage.createVisitor({ tenantId: 'default', visitorId: 'adult' })
    const rec = await consents.create({ visitorId: 'adult', profileId: profile.id, locale: 'en', consentJson: everything(), gpcDetected: false, source: 'banner', ageVerified: true })
    assert.deepEqual(new Set(stateOf(rec.consentJson, 'marketing')), new Set(['granted']))
    assert.equal((await receipts.forVisitor('default', 'adult'))[0]!.data.minor, undefined)
  })

  test('requests: provider outcome, token, dashboard decision, records keep only the hashed visitor ID', async () => {
    const a = await parental.request('default', 'v1', profile.id, 'hi')
    assert.equal(a.data.providerId, 'mock')
    assert.equal(a.ref, receipts.visitorRef('v1'))
    assert.doesNotMatch(JSON.stringify(a), /"v1"/)
    provider.reject(a.data.providerRef!)
    assert.equal((await parental.latest('default', 'v1'))!.status, 'failed')

    const b = await parental.verifyByToken('default', 'v2', profile.id)
    assert.equal(b.status, 'verified')
    assert.equal(b.data.method, 'site_token')

    const c = await parental.request('default', 'v3', profile.id, null)
    await assert.rejects(parental.decide('default', c.id, 'pending' as never, 'u1', null), (e: unknown) => e instanceof ParentalConsentError && e.status === 400)
    const decided = await parental.decide('default', c.id, 'verified', 'u1', 'Signed form received')
    assert.equal(decided.data.method, 'manual')
    assert.deepEqual(decided.data.history.map(h => h.source), ['request', 'dashboard'])
    await assert.rejects(parental.decide('default', c.id, 'failed', 'u1', null), (e: unknown) => e instanceof ParentalConsentError && e.status === 409)
    await assert.rejects(parental.decide('other', c.id, 'failed', 'u1', null), (e: unknown) => e instanceof ParentalConsentError && e.status === 404)
  })

  test('public routes: request returns the request state, status needs ownership, token resolution verifies', async () => {
    await storage.createVisitor({ tenantId: 'default', visitorId: 'kid2' })
    const rec = await consents.create({ visitorId: 'kid2', profileId: profile.id, locale: 'en', consentJson: {}, gpcDetected: false, source: 'banner', ageVerified: false })
    const pub = buildConsentRoutes(consents, new VisitorService(new VisitorRepo(storage), 'default', undefined, SECRET), profiles,
      async () => 'default', storage, SECRET, undefined, 7, undefined, parental)
    const cookie = buildOwnershipSetCookie('kid2', rec.id, SECRET).split(';')[0]!
    const call = (key: string, url: string, init: RequestInit, params: Record<string, string>) =>
      (pub as Record<string, (r: Request, p: Record<string, string>) => Promise<Response>>)[key]!(new Request(`http://localhost/consenti/api/v1${url}`, init), params)

    assert.equal((await call('GET /consent/:visitorId/parental-consent', '/consent/kid2/parental-consent', {}, { visitorId: 'kid2' })).status, 403)
    let res = await call('GET /consent/:visitorId/parental-consent', '/consent/kid2/parental-consent', { headers: { cookie } }, { visitorId: 'kid2' })
    assert.deepEqual(await res.json(), { status: 'none' })

    res = await call('POST /consent/:visitorId/parental-consent-request', '/consent/kid2/parental-consent-request',
      { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ profileId: profile.id, locale: 'hi' }) }, { visitorId: 'kid2' })
    const body = await res.json() as { token: string; requestId: string; status: string; message: string }
    assert.equal(res.status, 200)
    assert.match(body.token, /^pcon_/)
    assert.equal(body.status, 'pending')
    assert.match(body.message, /no verification/i)

    res = await call('POST /consent/parental-consent-resolve', '/consent/parental-consent-resolve',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: buildParentalConsentToken('kid2', profile.id, SECRET) }) }, {})
    assert.equal(res.status, 200)
    res = await call('GET /consent/:visitorId/parental-consent', '/consent/kid2/parental-consent', { headers: { cookie } }, { visitorId: 'kid2' })
    assert.equal((await res.json() as { status: string }).status, 'verified')
  })

  test('admin routes: list and decide', async () => {
    const audit = new AuditRepo(storage)
    const retention = new RetentionService(storage, consents, receipts, audit)
    const admin = buildAdminRecordRoutes(storage, { mode: 'jwt' }, SECRET, {
      receipts, noticeVersions: new NoticeVersionService(storage), retention, parentalConsent: parental,
      erasure: new ErasureRequestService(storage, audit, id => receipts.visitorRef(id), id => consents.erase(id), t => retention.getPolicy(t)),
    }) as Record<string, (r: Request, p: Record<string, string>) => Promise<Response>>
    const jwt = (perms: string[]) => signJwt({ sub: 'staff-1', email: 's@example.test', roles: [], permissions: perms, allowedTenants: [] }, SECRET)
    const req = await parental.request('default', 'v9', profile.id, null)
    let res = await admin['GET /parental-consents']!(new Request('http://localhost/x/parental-consents?status=pending', { headers: { authorization: `Bearer ${jwt(['consent:view'])}` } }), {})
    const list = await res.json() as { total: number; provider: string }
    assert.deepEqual([list.total, list.provider], [1, 'mock'])
    res = await admin['PATCH /parental-consents/:id']!(new Request('http://localhost/x', { method: 'PATCH', headers: { authorization: `Bearer ${jwt(['consent:view'])}` }, body: '{"status":"verified"}' }), { id: req.id })
    assert.equal(res.status, 403)
    res = await admin['PATCH /parental-consents/:id']!(new Request('http://localhost/x', { method: 'PATCH', headers: { authorization: `Bearer ${jwt(['settings:update'])}`, 'content-type': 'application/json' }, body: '{"status":"verified","note":"Form on file"}' }), { id: req.id })
    assert.equal(res.status, 200)
    assert.equal(await parental.isParentVerified('default', 'v9'), true)
  })
})
