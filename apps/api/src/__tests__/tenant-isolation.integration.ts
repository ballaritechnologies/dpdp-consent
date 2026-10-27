/**
 * Multi-site isolation, through the real server wiring (createConsenti): public requests are
 * recorded under the site they name, one site's records and profiles are invisible from another,
 * unknown sites are rejected, and profile file paths can't leave `profiles/<site>/`.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConsentDbRecord } from '@consenti/types'
import { createConsenti } from '../index.js'
import { TenantServices } from '../services/tenant-services.js'
import { SiteKeys, signHmac } from '../utils/crypto.js'
import { buildConsentSignaturePayload } from '../core/consent-engine.js'
import { buildParentalConsentToken } from '../utils/parental-consent-token.js'

const SIGNING = 'isolation-signing-secret'

describe('multi-site isolation (public API)', () => {
  let dir: string
  let app: ReturnType<typeof createConsenti>
  let siteB = ''
  const profileOf: Record<string, string> = {}

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-isolation-'))
    app = createConsenti({
      storage: { driver: 'json', path: dir },
      auth: { mode: 'local', adminEmail: 'admin@example.test', adminPassword: 'Isolation-Passw0rd-1', masterSecret: 'm'.repeat(64) },
      compliance: { type: 'opt-in-dpdpa', dataSigningHash: SIGNING },
      multiTenant: { enabled: true },
      rateLimit: { enabled: false },
    })
    await app.ready
    siteB = (await app.storage.createTenant({ name: 'Site B', slug: 'site-b' })).id
    for (const site of ['default', siteB]) {
      await app.servicesFor(site).profiles.seedDefaultProfile('opt-in-dpdpa')
      profileOf[site] = (await app.servicesFor(site).profiles.findActiveByComplianceGroup('opt-in-dpdpa', site))!.id
    }
  })
  after(async () => {
    await app.destroy()
    await app.storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const fetchApi = (path: string, init: RequestInit = {}) => app.honoApp.fetch(new Request(`http://localhost/consenti/api/v1${path}`, init))
  const give = (site: string, visitorId: string, profileId: string) => fetchApi(`/consent${site === 'default' ? '' : `?tenant=${site}`}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visitorId, profileId, locale: 'en', consentJson: {}, gpcDetected: false, source: 'banner' }),
  })

  test('a consent sent for site B is recorded under site B, with site B\'s profile', async () => {
    const res = await give(siteB, 'visitor-b1', profileOf[siteB]!)
    assert.equal(res.status, 201, await res.clone().text())
    const record = await res.json() as ConsentDbRecord
    assert.equal(record.tenantId, siteB)
    assert.equal((await app.storage.getConsent('visitor-b1'))?.tenantId, siteB)
  })

  test('a profile of another site is not found', async () => {
    assert.equal((await give(siteB, 'visitor-x', profileOf['default']!)).status, 404)
    assert.equal((await give('default', 'visitor-y', profileOf[siteB]!)).status, 404)
  })

  test('an unknown or malformed site is rejected, not filed under default', async () => {
    assert.equal((await give('no-such-site', 'visitor-z', profileOf[siteB]!)).status, 400)
    assert.equal((await give('../etc', 'visitor-z', profileOf[siteB]!)).status, 400)
    assert.equal(await app.storage.getConsent('visitor-z'), null)
  })

  test('a visitor of site B can\'t be read, changed or erased through site A', async () => {
    const res = await give(siteB, 'visitor-b2', profileOf[siteB]!)
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const viaDefault = (method: string) => fetchApi('/consent/visitor-b2', { method, headers: { cookie, 'content-type': 'application/json' }, ...(method === 'PUT' ? { body: JSON.stringify({ consentJson: {} }) } : {}) })
    // Refused either way: site B's cookie isn't valid on site A (403), and the record isn't there (404).
    assert.ok([403, 404].includes((await viaDefault('GET')).status))
    assert.notEqual((await viaDefault('PUT')).status, 200)
    await viaDefault('DELETE')
    assert.ok(await app.storage.getConsent('visitor-b2'), 'still there after a DELETE through the wrong site')
    assert.equal((await fetchApi(`/consent/visitor-b2?tenant=${siteB}`, { headers: { cookie } })).status, 200)
  })

  test('a visitor ID already used by another site is refused, not taken over', async () => {
    await give(siteB, 'visitor-b3', profileOf[siteB]!)
    const res = await give('default', 'visitor-b3', profileOf['default']!)
    assert.equal(res.status, 409)
    assert.equal((await app.storage.getConsent('visitor-b3'))?.tenantId, siteB)
  })

  test('each site signs its consent records and receipts with its own key', async () => {
    const keys = new SiteKeys(SIGNING)
    await give(siteB, 'visitor-k1', profileOf[siteB]!)
    const record = (await app.storage.getConsent('visitor-k1'))!
    assert.equal(record.signature, signHmac(buildConsentSignaturePayload(record), keys.for(siteB)))
    assert.notEqual(record.signature, signHmac(buildConsentSignaturePayload(record), SIGNING))
    assert.equal(app.services.receipts.visitorRef('default', 'visitor-k1') === app.services.receipts.visitorRef(siteB, 'visitor-k1'), false)
    const [receipt] = await app.services.receipts.forVisitor(siteB, 'visitor-k1')
    assert.ok(receipt && app.services.receipts.verify(receipt), 'site B receipt verifies')
    assert.equal(app.services.receipts.verify({ ...receipt, tenantId: 'default' }), false, 'not as another site\'s')
  })

  test('an ownership cookie signed with the master key before per-site keys still works', async () => {
    await give(siteB, 'visitor-k2', profileOf[siteB]!)
    const record = (await app.storage.getConsent('visitor-k2'))!
    const legacy = `consenti_visitor-k2=${record.id}.${signHmac(`visitor-k2.${record.id}`, SIGNING)}`
    assert.equal((await fetchApi(`/consent/visitor-k2?tenant=${siteB}`, { headers: { cookie: legacy } })).status, 200)
    const otherSite = `consenti_visitor-k2=${record.id}.${signHmac(`visitor-k2.${record.id}`, new SiteKeys(SIGNING).for('other'))}`
    assert.equal((await fetchApi(`/consent/visitor-k2?tenant=${siteB}`, { headers: { cookie: otherSite } })).status, 403)
  })

  test('a parental-consent token issued for site B is refused on another site', async () => {
    const token = buildParentalConsentToken('kid-b', profileOf[siteB]!, new SiteKeys(SIGNING).for(siteB))
    const resolve = (site: string) => fetchApi(`/consent/parental-consent-resolve${site === 'default' ? '' : `?tenant=${site}`}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    })
    assert.equal((await resolve('default')).status, 403)
    assert.equal((await resolve(siteB)).status, 200)
  })

  test('profile routes: by-id lookups follow the named site; file paths are validated', async () => {
    assert.equal((await fetchApi(`/profiles/${profileOf[siteB]}`)).status, 404)
    assert.equal((await fetchApi(`/profiles/${profileOf[siteB]}?tenant=${siteB}`)).status, 200)
    assert.equal((await fetchApi('/profiles/default/..%2F..%2Fsecrets/en')).status, 400)
    assert.equal((await fetchApi('/profiles/default/opt-in-dpdpa/..%2Fx')).status, 400)
  })
})

describe('multi-site isolation (admin API)', () => {
  let dir: string
  let app: ReturnType<typeof createConsenti>
  let siteB = ''
  let adminToken = ''
  let bToken = ''
  const PASSWORD = 'Isolation-Passw0rd-1'

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-admin-isolation-'))
    app = createConsenti({
      storage: { driver: 'json', path: dir },
      auth: { mode: 'local', adminEmail: 'admin@example.test', adminPassword: PASSWORD, masterSecret: 'm'.repeat(64) },
      compliance: { type: 'opt-in-dpdpa', dataSigningHash: SIGNING },
      multiTenant: { enabled: true },
      rateLimit: { enabled: false },
    })
    await app.ready
    siteB = (await app.storage.createTenant({ name: 'Site B', slug: 'site-b' })).id
    adminToken = await login('admin@example.test')
    const created = await admin('/users', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Site B admin', email: 'b@example.test', password: PASSWORD, roleId: 'role_admin', allowedTenants: [siteB] }),
    })
    assert.equal(created.status, 201, await created.clone().text())
    bToken = await login('b@example.test')
  })
  after(async () => {
    await app.destroy()
    await app.storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  async function login(email: string): Promise<string> {
    const res = await admin('/auth/login', '', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) })
    assert.equal(res.status, 200, await res.clone().text())
    return (await res.json() as { token: string }).token
  }
  function admin(path: string, token: string, init: RequestInit = {}) {
    return app.honoApp.fetch(new Request(`http://localhost/consenti/admin/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }))
  }

  test('a user limited to site B can work on site B but not on default', async () => {
    assert.equal((await admin(`/consents?tenantId=${siteB}`, bToken)).status, 200)
    assert.equal((await admin('/consents', bToken)).status, 403)
    assert.equal((await admin('/consents?tenantId=default', bToken)).status, 403)
    assert.equal((await admin('/consents?tenantId=no-such-site', adminToken)).status, 404)
  })

  test('API keys: a body tenantId can\'t pick another site, and keys of another site are hidden', async () => {
    const other = await admin(`/apikeys?tenantId=${siteB}`, bToken, { method: 'POST', body: JSON.stringify({ name: 'k', tenantId: 'default' }) })
    assert.equal(other.status, 400)
    const mine = await admin(`/apikeys?tenantId=${siteB}`, bToken, { method: 'POST', body: JSON.stringify({ name: 'k' }) })
    assert.equal(mine.status, 201)
    const { id } = await mine.json() as { id: string }
    assert.equal((await app.storage.getApiKeys(siteB)).find(k => k.id === id)?.tenantId, siteB)
    // Through the default site, site B's key can't be revoked.
    assert.equal((await admin(`/apikeys/${id}`, adminToken, { method: 'DELETE' })).status, 404)
    assert.equal((await admin(`/apikeys/${id}?tenantId=${siteB}`, adminToken, { method: 'DELETE' })).status, 204)
  })

  test('templates: a template of site B is not found through default', async () => {
    const res = await admin(`/consent-templates?tenantId=${siteB}`, bToken, { method: 'POST', body: JSON.stringify({ name: 'B', cookies: {}, categories: { necessary: { heading: 'Necessary', htmlText: 'Needed for the site to work.', legalBasis: 'mandatory', cookies: [] } } }) })
    assert.equal(res.status, 201, await res.clone().text())
    const { id } = await res.json() as { id: string }
    assert.equal((await admin(`/consent-templates/${id}`, adminToken)).status, 404)
    assert.equal((await admin(`/consent-templates/${id}`, adminToken, { method: 'DELETE' })).status, 404)
    assert.equal((await admin(`/consent-templates/${id}?tenantId=${siteB}`, adminToken)).status, 200)
  })

  test('stats aggregate and the sites list only show the user\'s sites', async () => {
    const agg = await (await admin(`/stats/aggregate?tenantId=${siteB}`, bToken)).json() as { perTenant: { tenantId: string }[] }
    assert.deepEqual(agg.perTenant.map(r => r.tenantId), [siteB])
    const sites = await (await admin('/tenants', bToken)).json() as { id: string }[]
    assert.deepEqual(sites.map(t => t.id), [siteB])
    const all = await (await admin('/tenants', adminToken)).json() as { id: string }[]
    assert.ok(all.length >= 2)
  })

  test('only users of every site can create, rename or delete sites', async () => {
    assert.equal((await admin('/tenants', bToken, { method: 'POST', body: JSON.stringify({ name: 'C', slug: 'c' }) })).status, 403)
    assert.equal((await admin(`/tenants/${siteB}`, bToken, { method: 'PUT', body: JSON.stringify({ name: 'x' }) })).status, 403)
    assert.equal((await admin(`/tenants/${siteB}`, bToken, { method: 'DELETE' })).status, 403)
  })

  test('a site-limited admin can\'t create users, widen access or change roles', async () => {
    const newUser = { name: 'x', email: 'x@example.test', password: PASSWORD, roleId: 'role_admin', allowedTenants: [] }
    assert.equal((await admin(`/users?tenantId=${siteB}`, bToken, { method: 'POST', body: JSON.stringify(newUser) })).status, 403)
    assert.equal((await admin(`/users?tenantId=${siteB}`, bToken)).status, 403)
    const me = await (await admin('/auth/me', bToken)).json() as { id: string }
    assert.equal((await admin(`/users/${me.id}?tenantId=${siteB}`, bToken, { method: 'PUT', body: JSON.stringify({ allowedTenants: [] }) })).status, 403)
    assert.equal((await admin(`/roles?tenantId=${siteB}`, bToken, { method: 'POST', body: JSON.stringify({ name: 'r' }) })).status, 403)
    assert.equal((await admin(`/roles?tenantId=${siteB}`, bToken)).status, 200)
  })

  test('server-wide TCF settings are closed to site-limited users', async () => {
    const res = await admin(`/tcf/registration-status?tenantId=${siteB}`, bToken)
    assert.equal(res.status, 403)
  })
})

describe('per-site rate limits', () => {
  let dir: string
  let app: ReturnType<typeof createConsenti>
  let siteB = ''

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-ratelimit-'))
    app = createConsenti({
      storage: { driver: 'json', path: dir },
      auth: { mode: 'local', adminEmail: 'admin@example.test', adminPassword: 'Isolation-Passw0rd-1', masterSecret: 'm'.repeat(64) },
      compliance: { type: 'opt-in-dpdpa', dataSigningHash: SIGNING },
      multiTenant: { enabled: true },
      rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 3, siteLimits: id => (id === siteB ? { maxRequestsPerSite: 4 } : null) },
    })
    await app.ready
    siteB = (await app.storage.createTenant({ name: 'Site B', slug: 'site-b' })).id
  })
  after(async () => {
    await app.destroy()
    await app.storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const hit = (site: string, ip: string) => app.honoApp.fetch(new Request(
    `http://localhost/consenti/api/v1/consent/nobody${site === 'default' ? '' : `?tenant=${site}`}`, { headers: { 'x-real-ip': ip } },
  )).then(r => r.status)

  test('a visitor IP is counted separately on each site', async () => {
    for (let i = 0; i < 3; i++) assert.notEqual(await hit('default', '10.0.0.1'), 429)
    assert.equal(await hit('default', '10.0.0.1'), 429)
    assert.notEqual(await hit(siteB, '10.0.0.1'), 429, 'the same IP is not limited on site B')
  })

  test('a per-site cap limits all IPs together on that site only', async () => {
    for (const ip of ['10.0.1.1', '10.0.1.2', '10.0.1.3']) assert.notEqual(await hit(siteB, ip), 429)
    assert.equal(await hit(siteB, '10.0.1.4'), 429, 'site B used its 4 requests')
    assert.notEqual(await hit('default', '10.0.1.4'), 429, 'the default site is unaffected')
  })
})

describe('SiteKeys', () => {
  test('default keeps the master key; other sites get distinct derived keys', () => {
    const keys = new SiteKeys('master')
    assert.equal(keys.for('default'), 'master')
    assert.notEqual(keys.for('a'), 'master')
    assert.notEqual(keys.for('a'), keys.for('b'))
    assert.equal(keys.for('a'), new SiteKeys('master').for('a'), 'stable across restarts')
    assert.deepEqual(keys.verifying('default'), ['master'])
    assert.deepEqual(keys.verifying('a'), [keys.for('a'), 'master'])
    assert.equal(new SiteKeys('').for('a'), '', 'no master key: unsigned, as before')
  })
})

describe('TenantServices', () => {
  test('caches per site, never evicts default, and stays bounded', () => {
    let built = 0
    const ts = new TenantServices(() => { built++; return {} as never })
    const d = ts.for('default')
    assert.equal(ts.for('default'), d)
    for (let i = 0; i < TenantServices.MAX_SITES + 50; i++) ts.for(`site-${i}`)
    assert.equal(ts.for('default'), d, 'default survives eviction')
    assert.equal(built, TenantServices.MAX_SITES + 51)
    ts.for('site-0')
    assert.equal(built, TenantServices.MAX_SITES + 52, 'an evicted site is rebuilt on demand')
  })
})
