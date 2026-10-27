/**
 * Per-site consent regimes: the pure routing rule (`resolveRegimeGroup`), the service that applies
 * a tenant's stored regime on top of the jurisdiction map, the public geo-routing endpoints, the
 * stored setting on every bundled file/SQLite driver, and the SQLite v2 → v3 schema upgrade.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  EMBEDDED_COMPLIANCE_MAP,
  regimeHardening, hardenProfile,
  resolveRegimeGroup,
} from '@consenti/utils'
import type { StorageAdapter, StorageConfig, TenantSettings } from '@consenti/types'
import { GeoResolverService, type ResolvedGeo } from '../services/geo-resolver.service.js'
import { RegimeService } from '../services/regime.service.js'
import { buildProfileRoutes } from '../routes/public/profile.routes.js'
import type { ProfileService } from '../services/profile.service.js'
import { regimeFromColumn, regimeToColumn } from '../storage/regime-column.js'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { NodeSqliteBuiltinAdapter } from '../storage/sqlite/node-sqlite-builtin.adapter.js'
import { NodeSqlite3WasmAdapter } from '../storage/sqlite/node-sqlite3-wasm.adapter.js'
import { SCHEMA_SQL_SQLITE, SEED_SQL, SCHEMA_VERSION } from '../storage/seed-data.js'
import { buildAdminSettingsRoutes } from '../routes/admin/settings.routes.js'
import { signJwt } from '../utils/crypto.js'

// ─── resolveRegimeGroup ───────────────────────────────────────────────────────

describe('resolveRegimeGroup — dpdp', () => {
  for (const country of ['IN', 'DE', 'GB', 'US', 'CN', '', 'ZZ']) {
    test(`${country || '(unknown)'} → opt-in-dpdpa`, () => {
      assert.equal(resolveRegimeGroup('dpdp', country), 'opt-in-dpdpa')
    })
  }

  test('a configured default group is irrelevant — everyone gets DPDP', () => {
    assert.equal(resolveRegimeGroup('dpdp', 'US', 'opt-out'), 'opt-in-dpdpa')
  })
})

describe('resolveRegimeGroup — dpdp_gdpr', () => {
  test('India → DPDP flow, case- and whitespace-insensitive', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'IN'), 'opt-in-dpdpa')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'in'), 'opt-in-dpdpa')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', ' In '), 'opt-in-dpdpa')
  })

  test('EU member states → GDPR flow', () => {
    for (const country of ['DE', 'FR', 'IE', 'NL', 'PL', 'SE', 'GR', 'CY', 'MT']) {
      assert.equal(resolveRegimeGroup('dpdp_gdpr', country, 'opt-out'), 'opt-in', country)
    }
  })

  test('EEA (Iceland, Liechtenstein, Norway) → GDPR flow', () => {
    for (const country of ['IS', 'LI', 'NO']) {
      assert.equal(resolveRegimeGroup('dpdp_gdpr', country, 'opt-out'), 'opt-in', country)
    }
  })

  test('UK as ISO GB and as the map key UK both → GDPR flow', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'GB', 'opt-out'), 'opt-in')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'UK', 'opt-out'), 'opt-in')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'gb', 'opt-out'), 'opt-in')
  })

  test('Switzerland is neither EU/EEA nor UK → default group', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'CH', 'opt-out'), 'opt-out')
  })

  test('other countries → the configured default group', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'US', 'opt-out-strict'), 'opt-out-strict')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'BR', 'notice-only'), 'notice-only')
  })

  test('other countries with no default configured → opt-in', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'US'), 'opt-in')
  })

  test('unknown geo (empty country) → the default group, not India and not GDPR', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', '', 'opt-out'), 'opt-out')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', '   ', 'opt-out'), 'opt-out')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', ''), 'opt-in')
  })

  test('unrecognised country codes → the default group', () => {
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'ZZ', 'opt-out'), 'opt-out')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'EU', 'opt-out'), 'opt-out')
    assert.equal(resolveRegimeGroup('dpdp_gdpr', 'IND', 'opt-out'), 'opt-out')
  })
})

describe('resolveRegimeGroup — strictest_global', () => {
  test('everyone gets the DPDP flow, wherever they are', () => {
    for (const c of ['IN', 'DE', 'GB', 'US', 'BR', '']) assert.equal(resolveRegimeGroup('strictest_global', c), 'opt-in-dpdpa', c)
  })

  test('hardening: GPC honoured for advertising, expiry capped, strict GPC never loosened', () => {
    assert.equal(regimeHardening('dpdp'), null)
    const h = regimeHardening('strictest_global')!
    const profile = { gpcMode: 'ignore' as const, expiryDays: 730, cookies: { ad: { purpose: 'marketing', listenGpc: false }, stats: { purpose: 'analytics', listenGpc: false } } }
    const hard = hardenProfile(profile, h)
    assert.equal(hard.gpcMode, 'honor')
    assert.equal(hard.expiryDays, 365)
    assert.equal(hard.cookies.ad.listenGpc, true)
    assert.equal(hard.cookies.stats.listenGpc, false)
    assert.equal(hardenProfile({ ...profile, gpcMode: 'strict' as const, expiryDays: 90 }, h).gpcMode, 'strict')
    assert.equal(hardenProfile({ ...profile, expiryDays: 90 }, h).expiryDays, 90)
    assert.equal(profile.cookies.ad.listenGpc, false, 'input not mutated')
  })
})

// ─── RegimeService ────────────────────────────────────────────────────────────

const settingsFor = (byTenant: Record<string, TenantSettings>) =>
  async (tenantId: string): Promise<TenantSettings> => byTenant[tenantId] ?? {}

describe('RegimeService', () => {
  const coloradoGeo: ResolvedGeo = { country: 'US', region: 'CO', complianceGroup: 'opt-out', requiresSensitiveOptIn: true }

  test('no regime set → the jurisdiction-map result is returned unchanged (backward compatible)', async () => {
    const service = new RegimeService(settingsFor({}))
    assert.deepEqual(await service.apply('default', coloradoGeo), coloradoGeo)
  })

  test('a stored value that is not a known regime is ignored', async () => {
    const service = new RegimeService(settingsFor({ default: { regime: 'gdpr_only' as unknown as 'dpdp' } }))
    assert.deepEqual(await service.apply('default', coloradoGeo), coloradoGeo)
  })

  test('regimes are read per tenant', async () => {
    const service = new RegimeService(settingsFor({ a: { regime: 'dpdp' } }))
    assert.equal((await service.apply('a', coloradoGeo)).complianceGroup, 'opt-in-dpdpa')
    assert.equal((await service.apply('b', coloradoGeo)).complianceGroup, 'opt-out')
  })

  test('re-routing drops the map group\'s requiresSensitiveOptIn carve-out', async () => {
    const service = new RegimeService(settingsFor({ default: { regime: 'dpdp' } }))
    const geo = await service.apply('default', coloradoGeo)
    assert.equal(geo.complianceGroup, 'opt-in-dpdpa')
    assert.equal(geo.requiresSensitiveOptIn, undefined)
    assert.equal(geo.country, 'US', 'country/region still describe the visitor')
  })

  test('routing to the same group keeps the carve-out', async () => {
    const service = new RegimeService(settingsFor({ default: { regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' } }))
    assert.deepEqual(await service.apply('default', coloradoGeo), coloradoGeo)
  })

  test('an invalid stored default group falls back to opt-in', async () => {
    const service = new RegimeService(settingsFor({ default: { regime: 'dpdp_gdpr', regimeDefaultGroup: 'nope' as unknown as 'opt-out' } }))
    assert.equal((await service.apply('default', coloradoGeo)).complianceGroup, 'opt-in')
  })
})

// ─── GET /resolve-profile and GET /profiles/auto/:locale ─────────────────────

describe('public geo-routing endpoints with a regime', () => {
  interface Lookup { group: string; tenantId: string | undefined }

  function setup(opts: {
    country: string | null
    settings?: Record<string, TenantSettings>
    multiTenant?: boolean
    withRegime?: boolean
  }) {
    const lookups: Lookup[] = []
    const profiles = {
      findActiveByComplianceGroup: async (group: string, tenantId?: string) => {
        lookups.push({ group, tenantId })
        return null
      },
    } as unknown as ProfileService
    const geo = new GeoResolverService(async () => ({ country: opts.country, region: null, locale: null }), EMBEDDED_COMPLIANCE_MAP)
    const routes = buildProfileRoutes(profiles, geo, undefined, '', {
      ...(opts.withRegime === false ? {} : { regime: new RegimeService(settingsFor(opts.settings ?? {})) }),
      multiTenant: opts.multiTenant ?? false,
    })
    return { routes, lookups }
  }

  async function resolve(routes: ReturnType<typeof setup>['routes'], query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await routes['GET /resolve-profile'](new Request(`http://localhost/consenti/api/v1/resolve-profile${query}`), {})
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  test('no regime service wired → exact pre-regime behaviour', async () => {
    const { routes, lookups } = setup({ country: 'US', withRegime: false })
    const { body } = await resolve(routes)
    assert.equal(body['complianceGroup'], 'opt-out-strict')
    assert.deepEqual(lookups, [{ group: 'opt-out-strict', tenantId: 'default' }])
  })

  test('tenant without a regime → jurisdiction map', async () => {
    const { routes } = setup({ country: 'DE' })
    assert.equal((await resolve(routes)).body['complianceGroup'], 'opt-in')
  })

  test('dpdp: a German visitor gets the DPDP flow', async () => {
    const { routes, lookups } = setup({ country: 'DE', settings: { default: { regime: 'dpdp' } } })
    assert.equal((await resolve(routes)).body['complianceGroup'], 'opt-in-dpdpa')
    assert.equal(lookups[0]?.group, 'opt-in-dpdpa')
  })

  test('dpdp_gdpr: India, GB and the default group', async () => {
    const settings = { default: { regime: 'dpdp_gdpr' as const, regimeDefaultGroup: 'opt-out' as const } }
    assert.equal((await resolve(setup({ country: 'IN', settings }).routes)).body['complianceGroup'], 'opt-in-dpdpa')
    assert.equal((await resolve(setup({ country: 'GB', settings }).routes)).body['complianceGroup'], 'opt-in')
    assert.equal((await resolve(setup({ country: 'US', settings }).routes)).body['complianceGroup'], 'opt-out')
  })

  test('dpdp_gdpr: unknown geo → the configured default group, not the hard-coded opt-in fallback', async () => {
    const settings = { default: { regime: 'dpdp_gdpr' as const, regimeDefaultGroup: 'opt-out' as const } }
    const { routes, lookups } = setup({ country: null, settings })
    assert.equal((await resolve(routes)).body['complianceGroup'], 'opt-out')
    assert.equal(lookups[0]?.group, 'opt-out')
  })

  test('strictest_global: everyone gets the DPDP flow plus the hardening block', async () => {
    const { routes } = setup({ country: 'US', settings: { default: { regime: 'strictest_global' } } })
    const { status, body } = await resolve(routes)
    assert.equal(status, 200)
    assert.equal(body['complianceGroup'], 'opt-in-dpdpa')
    assert.deepEqual(body['hardening'], { gpcMode: 'honor', gpcItemPurposes: ['marketing'], maxExpiryDays: 365 })
    const plain = await resolve(setup({ country: 'US', settings: { default: { regime: 'dpdp' } } }).routes)
    assert.equal(plain.body['hardening'], undefined)
  })

  test('multi-tenant: ?tenant= selects that tenant\'s regime and profiles', async () => {
    const settings = { 'tenant-a': { regime: 'dpdp' as const } }
    const { routes, lookups } = setup({ country: 'DE', settings, multiTenant: true })
    assert.equal((await resolve(routes, '?tenant=tenant-a')).body['complianceGroup'], 'opt-in-dpdpa')
    assert.deepEqual(lookups, [{ group: 'opt-in-dpdpa', tenantId: 'tenant-a' }])
  })

  test('multi-tenant: no ?tenant= → default tenant', async () => {
    const { routes, lookups } = setup({ country: 'DE', settings: { 'tenant-a': { regime: 'dpdp' } }, multiTenant: true })
    assert.equal((await resolve(routes)).body['complianceGroup'], 'opt-in')
    assert.equal(lookups[0]?.tenantId, 'default')
  })

  test('multi-tenant: an unsafe tenant id is rejected before it can reach a file path', async () => {
    const { routes, lookups } = setup({ country: 'DE', multiTenant: true })
    for (const bad of ['../etc', 'a/b', 'con', '-x', 'x'.repeat(65)]) {
      assert.equal((await resolve(routes, `?tenant=${encodeURIComponent(bad)}`)).status, 400, bad)
    }
    assert.equal(lookups.length, 0)
  })

  test('single-tenant: ?tenant= is ignored', async () => {
    const { routes, lookups } = setup({ country: 'DE', settings: { 'tenant-a': { regime: 'dpdp' } }, multiTenant: false })
    assert.equal((await resolve(routes, '?tenant=tenant-a')).body['complianceGroup'], 'opt-in')
    assert.equal(lookups[0]?.tenantId, 'default')
  })

  test('legacy GET /profiles/auto/:locale applies the regime too', async () => {
    const { routes, lookups } = setup({ country: 'DE', settings: { default: { regime: 'dpdp' } } })
    const res = await routes['GET /profiles/auto/:locale'](new Request('http://localhost/consenti/api/v1/profiles/auto/en'), { locale: 'en' })
    assert.equal(res.status, 404, 'no profile is seeded in this test')
    assert.equal(lookups[0]?.group, 'opt-in-dpdpa')
  })
})

// ─── Storage ──────────────────────────────────────────────────────────────────

describe('regime_json column encoding', () => {
  test('round-trips, and an unset regime is NULL', () => {
    assert.equal(regimeToColumn({}), null)
    assert.equal(regimeToColumn({ regimeDefaultGroup: 'opt-out' }), null, 'a default group without a regime is meaningless')
    const col = regimeToColumn({ regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' })
    assert.deepEqual(regimeFromColumn(col), { regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' })
    assert.deepEqual(regimeFromColumn(JSON.parse(col ?? '{}')), { regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' }, 'JSONB / Mongo objects')
  })

  test('garbage is dropped rather than routed', () => {
    assert.deepEqual(regimeFromColumn(null), {})
    assert.deepEqual(regimeFromColumn('not json'), {})
    assert.deepEqual(regimeFromColumn('{"regime":"gdpr"}'), {})
    assert.deepEqual(regimeFromColumn('{"regime":"dpdp","regimeDefaultGroup":"nope"}'), { regime: 'dpdp' })
  })
})

const DRIVERS: Array<[string, (dir: string) => StorageAdapter]> = [
  ['json', dir => new JsonFileAdapter({ driver: 'json', path: dir })],
  ['node:sqlite', dir => new NodeSqliteBuiltinAdapter({ driver: 'node:sqlite', path: dir } as StorageConfig)],
  ['node-sqlite3-wasm', dir => new NodeSqlite3WasmAdapter({ driver: 'node-sqlite3-wasm', path: dir } as StorageConfig)],
]

for (const [driver, make] of DRIVERS) describe(`tenant regime settings (${driver})`, () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'consenti-regime-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('set, read back, keep other settings, and clear', async () => {
    const storage = make(dir)
    await storage.connect()
    try {
      assert.equal((await storage.getSettings('default')).regime, undefined, 'unset by default')
      await storage.updateSettings('default', { allowedOrigins: ['https://a.example'] })
      await storage.updateSettings('default', { regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' })
      let s = await storage.getSettings('default')
      assert.equal(s.regime, 'dpdp_gdpr')
      assert.equal(s.regimeDefaultGroup, 'opt-out')
      assert.deepEqual(s.allowedOrigins, ['https://a.example'], 'other settings are untouched')

      await storage.updateSettings('default', { allowedOrigins: ['https://b.example'] })
      assert.equal((await storage.getSettings('default')).regime, 'dpdp_gdpr', 'unrelated updates keep the regime')

      await storage.updateSettings('default', { regime: undefined, regimeDefaultGroup: undefined })
      s = await storage.getSettings('default')
      assert.equal(s.regime, undefined)
      assert.equal(s.regimeDefaultGroup, undefined)
    } finally {
      await storage.disconnect()
    }

    const reopened = make(dir)
    await reopened.connect()
    try {
      assert.equal((await reopened.getSettings('default')).regime, undefined, 'the clear was persisted')
    } finally {
      await reopened.disconnect()
    }
  })
})

describe('SQLite schema v2 → v3', () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'consenti-migrate-v3-'))
    dbPath = join(dir, 'db', 'consenti.db')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function seedV2Db(): void {
    mkdirSync(join(dir, 'db'), { recursive: true })
    const db = new DatabaseSync(dbPath)
    const v2Schema = SCHEMA_SQL_SQLITE.replace(/^ {2}regime_json[^\n]*\n/m, '')
    assert.notEqual(v2Schema, SCHEMA_SQL_SQLITE, 'the v2 schema really lacks regime_json')
    db.exec(v2Schema)
    db.exec(SEED_SQL)
    db.exec(`INSERT INTO tenant_settings (tenant_id, allowed_origins_json) VALUES ('default', '["https://kept.example"]'); PRAGMA user_version = 2;`)
    db.close()
  }

  for (const [driver, Adapter] of [
    ['node:sqlite', NodeSqliteBuiltinAdapter],
    ['node-sqlite3-wasm', NodeSqlite3WasmAdapter],
  ] as const) {
    test(`adds regime_json, keeps existing settings, stamps v${SCHEMA_VERSION} (${driver})`, async () => {
      seedV2Db()
      for (let run = 0; run < 2; run++) {
        const storage = new Adapter({ driver, path: dir } as StorageConfig)
        await storage.connect()
        try {
          const s = await storage.getSettings('default')
          assert.deepEqual(s.allowedOrigins, ['https://kept.example'])
          if (run === 0) {
            assert.equal(s.regime, undefined)
            await storage.updateSettings('default', { regime: 'dpdp' })
          } else {
            assert.equal(s.regime, 'dpdp', 'second connect is a no-op upgrade')
          }
        } finally {
          await storage.disconnect()
        }
      }
      const check = new DatabaseSync(dbPath)
      assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION)
      check.close()
    })
  }
})

// ─── Admin API: PATCH/GET /settings ──────────────────────────────────────────

describe('admin settings API — regime', () => {
  const SECRET = 'test-secret'
  let dir: string
  let storage: StorageAdapter
  let routes: ReturnType<typeof buildAdminSettingsRoutes>

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'consenti-regime-admin-'))
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
    routes = buildAdminSettingsRoutes(storage, { mode: 'jwt' }, SECRET)
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  function token(allowedTenants: string[] = [], permissions = ['settings:update']): string {
    return signJwt({ sub: 'user-1', email: 'admin@example.test', roles: [], permissions, allowedTenants }, SECRET)
  }

  async function call(method: 'GET' | 'PATCH', opts: { body?: unknown; query?: string; jwt?: string } = {}) {
    const req = new Request(`http://localhost/consenti/admin/v1/settings${opts.query ?? ''}`, {
      method,
      headers: { authorization: `Bearer ${opts.jwt ?? token()}`, 'content-type': 'application/json' },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })
    const res = await routes[`${method} /settings`](req, {})
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  test('sets, reads back and clears a regime', async () => {
    let r = await call('PATCH', { body: { regime: 'dpdp_gdpr', regimeDefaultGroup: 'opt-out' } })
    assert.equal(r.status, 200)
    assert.equal(r.body['regime'], 'dpdp_gdpr')
    r = await call('GET')
    assert.equal(r.body['regimeDefaultGroup'], 'opt-out')
    r = await call('PATCH', { body: { regime: null, regimeDefaultGroup: null } })
    assert.equal(r.status, 200)
    assert.equal(r.body['regime'], undefined)
  })

  test('validates input', async () => {
    assert.equal((await call('PATCH', { body: { regime: 'gdpr' } })).status, 400)
    assert.equal((await call('PATCH', { body: { regime: 42 } })).status, 400)
    assert.equal((await call('PATCH', { body: { regimeDefaultGroup: 'custom-group' } })).status, 400)
  })

  test('strictest_global can be set', async () => {
    const r = await call('PATCH', { body: { regime: 'strictest_global' } })
    assert.equal(r.status, 200)
    assert.equal((await storage.getSettings('default')).regime, 'strictest_global')
  })

  test('every regime change is written to the audit log; unrelated updates are not', async () => {
    await call('PATCH', { body: { regime: 'dpdp' } })
    await call('PATCH', { body: { regime: 'dpdp' } })
    await call('PATCH', { body: { allowedOrigins: ['https://a.example'] } })
    await call('PATCH', { body: { regime: 'dpdp_gdpr' } })
    const logs = await storage.getLogs({ tenantId: 'default', action: 'settings:regime_updated' })
    assert.equal(logs.items.length, 2)
  })

  test('?tenantId= targets another tenant and respects allowedTenants', async () => {
    const tenant = await storage.createTenant({ name: 'Site B', slug: 'site-b' })
    let r = await call('PATCH', { query: `?tenantId=${tenant.id}`, body: { regime: 'dpdp' } })
    assert.equal(r.status, 200)
    assert.equal((await storage.getSettings(tenant.id)).regime, 'dpdp')
    assert.equal((await storage.getSettings('default')).regime, undefined, 'default tenant untouched')

    r = await call('PATCH', { query: `?tenantId=${tenant.id}`, body: { regime: 'dpdp_gdpr' }, jwt: token(['default']) })
    assert.equal(r.status, 403)
    assert.equal((await call('GET', { query: '?tenantId=does-not-exist' })).status, 404)
  })

  test('requires settings:update', async () => {
    assert.equal((await call('PATCH', { body: { regime: 'dpdp' }, jwt: token([], ['profile:view']) })).status, 403)
  })
})
