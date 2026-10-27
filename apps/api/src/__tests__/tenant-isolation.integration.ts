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
    assert.equal((await viaDefault('GET')).status, 404)
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

  test('profile routes: by-id lookups follow the named site; file paths are validated', async () => {
    assert.equal((await fetchApi(`/profiles/${profileOf[siteB]}`)).status, 404)
    assert.equal((await fetchApi(`/profiles/${profileOf[siteB]}?tenant=${siteB}`)).status, 200)
    assert.equal((await fetchApi('/profiles/default/..%2F..%2Fsecrets/en')).status, 400)
    assert.equal((await fetchApi('/profiles/default/opt-in-dpdpa/..%2Fx')).status, 400)
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
