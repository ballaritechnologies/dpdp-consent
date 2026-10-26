/**
 * DPDP flow, API side (Phase 2): `dpdpa` profile-config validation, the no-pre-ticked-consent
 * rule for DPDP profiles, and seeding the default DPDP profile with its Indian languages.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CategoryMap, CookieMap } from '@consenti/types'
import { findDpdpaProblem } from '../validators/dpdpa.validator.js'
import { validateCreateProfile, validateUpdateProfile } from '../validators/profile.validator.js'
import { validateProfileCompliance } from '../services/compliance-validator.service.js'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { ProfileRepo } from '../repositories/profile.repo.js'
import { AuditRepo } from '../repositories/audit.repo.js'
import { ProfileService } from '../services/profile.service.js'

const VALID = { dataFiduciary: 'Acme Pvt Ltd', grievanceEmail: 'grievance@acme.example' }

describe('dpdpa config validation', () => {
  test('absent is fine; the two required fields are enough', () => {
    assert.equal(findDpdpaProblem(undefined), null)
    assert.equal(findDpdpaProblem(VALID), null)
  })

  test('every optional field, well formed', () => {
    assert.equal(findDpdpaProblem({
      ...VALID,
      purposeDescription: 'Running the store',
      grievanceOfficer: 'R. Sharma',
      grievanceUrl: 'https://acme.example/grievance',
      noticeStatus: 'reviewed',
      noticeVersion: '2026-10',
      reopenControl: false,
      labels: { hi: { reopenButton: 'गोपनीयता विकल्प' }, 'mr-IN': { withdraw: 'संमती मागे घ्या' } },
    }), null)
  })

  test('rejects bad values', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not an object', /must be an object/],
      [{ grievanceEmail: 'a@b.c' }, /dataFiduciary is required/],
      [{ ...VALID, dataFiduciary: '   ' }, /dataFiduciary is required/],
      [{ ...VALID, grievanceEmail: 'javascript:alert(1)' }, /email address/],
      [{ ...VALID, grievanceUrl: 'http://acme.example' }, /https/],
      [{ ...VALID, grievanceUrl: 'javascript:alert(1)' }, /https/],
      [{ ...VALID, noticeStatus: 'final' }, /noticeStatus/],
      [{ ...VALID, reopenControl: 'yes' }, /reopenControl/],
      [{ ...VALID, labels: { '../x': {} } }, /invalid locale/],
      [{ ...VALID, labels: { hi: { unknownKey: 'x' } } }, /not a known label/],
      [{ ...VALID, labels: { hi: { withdraw: 42 } } }, /must be a string/],
      [{ ...VALID, purposeDescription: 'x'.repeat(501) }, /at most 500/],
    ]
    for (const [input, expected] of cases) assert.match(findDpdpaProblem(input) ?? '', expected, JSON.stringify(input).slice(0, 80))
  })

  test('profile create and update run it', () => {
    const create = {
      name: 'DPDP', defaultLocale: 'en',
      profileJson: { consentTemplateId: 'ct', uiTemplateId: 'ut', dpdpa: { ...VALID, grievanceUrl: 'ftp://x' } },
    }
    assert.match(validateCreateProfile(create).error ?? '', /https/)
    assert.match(validateUpdateProfile({ profileJson: { dpdpa: { ...VALID, noticeStatus: 'nope' } } }).error ?? '', /noticeStatus/)
    assert.equal(validateUpdateProfile({ profileJson: { dpdpa: VALID } }).valid, true)
  })
})

describe('DPDP compliance rules', () => {
  const categories: CategoryMap = {
    necessary: { heading: 'Essential', htmlText: '', legalBasis: 'mandatory', cookies: ['security_storage'] },
    analytics: { heading: 'Analytics', htmlText: '', legalBasis: 'consent', cookies: ['analytics_storage'] },
  } as unknown as CategoryMap

  test('a pre-ticked consent purpose is an error, not a warning', () => {
    const cookies = {
      security_storage: { purpose: 'necessary', listenGpc: false },
      analytics_storage: { purpose: 'analytics', listenGpc: false, preGrant: true },
    } as unknown as CookieMap
    const result = validateProfileCompliance(cookies, categories, 'opt-in-dpdpa')
    assert.equal(result.valid, false)
    assert.deepEqual(result.errors.map(e => [e.cookieId, e.rule]), [['analytics_storage', 'no-pre-ticked-consent']])
  })

  test('the same profile is only a warning under GDPR opt-in (upstream behaviour unchanged)', () => {
    const cookies = { analytics_storage: { purpose: 'analytics', listenGpc: false, preGrant: true } } as unknown as CookieMap
    const result = validateProfileCompliance(cookies, categories, 'opt-in')
    assert.equal(result.valid, true)
    assert.equal(result.warnings.length, 1)
  })

  test('pre-granting the essential purpose is not an error (it is always on anyway)', () => {
    const cookies = { security_storage: { purpose: 'necessary', listenGpc: false, preGrant: true } } as unknown as CookieMap
    assert.equal(validateProfileCompliance(cookies, categories, 'opt-in-dpdpa').valid, true)
  })
})

describe('seeding the default DPDP profile', () => {
  let dir: string
  let storage: JsonFileAdapter
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'consenti-dpdp-seed-'))
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  test('includes Hindi, Kannada, Telugu and Tamil alongside English', async () => {
    const service = new ProfileService(new ProfileRepo(storage), new AuditRepo(storage), 'default', storage, undefined, undefined, join(dir, 'profiles'))
    await service.seedDefaultProfile('opt-in-dpdpa')
    const profile = await service.findActiveByComplianceGroup('opt-in-dpdpa')
    assert.ok(profile, 'seeded and active')
    const locales = profile.profileJson.locales ?? []
    for (const locale of ['en', 'hi', 'kn', 'te', 'ta']) assert.ok(locales.includes(locale), locale)
    const categories = Object.keys(profile.profileJson.preferenceModal?.categories ?? {})
    assert.deepEqual(categories, ['necessary', 'functional', 'preferences', 'analytics', 'marketing'])
  })
})
