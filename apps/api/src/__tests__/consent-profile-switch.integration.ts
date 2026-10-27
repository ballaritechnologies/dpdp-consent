/**
 * One consent record per visitor: a visitor who decides again under another profile (e.g. moving
 * between the DPDP and GDPR flows of a `dpdp_gdpr` regime) moves their record to that profile,
 * and the record still verifies.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConsenti } from '../index.js'

describe('a visitor switching profiles', () => {
  let dir: string
  let app: ReturnType<typeof createConsenti>
  const profileOf: Record<string, string> = {}

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-switch-'))
    app = createConsenti({
      storage: { driver: 'json', path: dir },
      auth: { mode: 'local', adminEmail: 'admin@example.test', adminPassword: 'Switch-Passw0rd-12', masterSecret: 'm'.repeat(64) },
      compliance: { type: 'auto', dataSigningHash: 'switch-secret' },
      rateLimit: { enabled: false },
    })
    await app.ready
    for (const group of ['opt-in-dpdpa', 'opt-in']) {
      await app.servicesFor('default').profiles.seedDefaultProfile(group)
      profileOf[group] = (await app.servicesFor('default').profiles.findActiveByComplianceGroup(group, 'default'))!.id
    }
  })
  after(async () => {
    await app.destroy()
    await app.storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const give = (visitorId: string, profileId: string, cookie?: string) => app.honoApp.fetch(new Request('http://localhost/consenti/api/v1/consent', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ visitorId, profileId, locale: 'en', consentJson: {}, gpcDetected: false, source: 'banner' }),
  }))

  test('the record moves to the new profile and still verifies', async () => {
    const first = await give('switcher', profileOf['opt-in-dpdpa']!)
    assert.equal(first.status, 201, await first.clone().text())
    const cookie = first.headers.get('set-cookie')!.split(';')[0]!
    const second = await give('switcher', profileOf['opt-in']!, cookie)
    assert.ok(second.status < 300, await second.clone().text())

    const record = (await app.storage.getConsent('switcher'))!
    assert.equal(record.profileId, profileOf['opt-in'], 'the record names the profile the decision was made under')
    const result = await app.servicesFor('default').consents.verify('switcher')
    assert.ok(!result.reasons.includes('hmac_invalid'), `reasons: ${result.reasons.join(', ')}`)
    assert.equal(result.valid, true, `reasons: ${result.reasons.join(', ')}`)

    const receipts = await app.services.receipts.forVisitor('default', 'switcher')
    assert.equal(receipts[0]!.data.profileId, profileOf['opt-in'], 'the newest receipt names the new profile')
  })
})
