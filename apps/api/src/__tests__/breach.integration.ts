/**
 * Breach incidents (Phase 7): validation, the 72-hour deadline, reminders, milestones, DRAFT
 * notices from editable templates, admin routes and export.
 *
 * Run: tsx --test src/__tests__/*.integration.ts
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { BreachDeadlineEvent, BreachIncident } from '@consenti/types'
import { JsonFileAdapter } from '../storage/json/json-file.adapter.js'
import { AuditRepo } from '../repositories/audit.repo.js'
import { BreachService, BreachError, validateBreachFields } from '../services/breach.service.js'
import { BREACH_DRAFT_LABEL, renderNotice } from '../services/breach-notice.js'
import { buildAdminBreachRoutes } from '../routes/admin/breach.routes.js'
import { signJwt } from '../utils/crypto.js'

const SECRET = 'breach-test-secret'
const HOUR = 3_600_000
const BUILT_IN = join(import.meta.dirname, '..', '..', 'templates', 'breach')

describe('breach field validation', () => {
  const ok = { title: 'Leaked backup', description: 'A backup was public', discoveredAt: new Date().toISOString(), severity: 'high' }
  test('requires the core fields and checks types', () => {
    assert.equal(validateBreachFields(ok, false).severity, 'high')
    for (const k of ['title', 'description', 'discoveredAt', 'severity']) {
      assert.throws(() => validateBreachFields({ ...ok, [k]: undefined }, false), BreachError, k)
    }
    assert.throws(() => validateBreachFields({ ...ok, severity: 'huge' }, false), /severity/)
    assert.throws(() => validateBreachFields({ ...ok, discoveredAt: 'yesterday' }, false), /ISO date/)
    assert.throws(() => validateBreachFields({ ...ok, discoveredAt: new Date(Date.now() + 2 * HOUR).toISOString() }, false), /future/)
    assert.throws(() => validateBreachFields({ ...ok, affectedCount: -1 }, false), /affectedCount/)
    assert.throws(() => validateBreachFields({ ...ok, dataCategories: 'emails' }, false), /dataCategories/)
    assert.throws(() => validateBreachFields({ ...ok, contactEmail: 'nope' }, false), /contactEmail/)
    assert.throws(() => validateBreachFields({ title: '' }, true), /title/)
    assert.deepEqual(validateBreachFields({ dataCategories: [' email ', 'email', ''] }, true), { dataCategories: ['email'] })
  })
})

describe('notice rendering', () => {
  test('fills placeholders, marks unknown ones, and always carries the draft label', () => {
    const out = renderNotice('Hello {{organisation}} {{unknown}}', { organisation: 'Acme' })
    assert.equal(out, `${BREACH_DRAFT_LABEL}\n\nHello Acme [to be completed]`)
    const kept = renderNotice(`${BREACH_DRAFT_LABEL}\nBody`, {})
    assert.equal(kept.split(BREACH_DRAFT_LABEL).length, 2, 'not added twice')
  })
})

describe('breach incidents', () => {
  let dir: string
  let storage: JsonFileAdapter
  let bus: EventEmitter
  let breaches: BreachService
  let customDir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ijazat-breach-'))
    customDir = join(dir, 'my-templates')
    mkdirSync(customDir)
    storage = new JsonFileAdapter({ driver: 'json', path: dir })
    await storage.connect()
    bus = new EventEmitter()
    breaches = new BreachService(storage, new AuditRepo(storage), [customDir, BUILT_IN], bus)
  })
  afterEach(async () => {
    await storage.disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const discovered = new Date(Date.now() - HOUR).toISOString()
  const create = () => breaches.create('default', {
    title: 'Exposed customer export', description: 'A CSV export was reachable without login.', discoveredAt: discovered,
    severity: 'high', dataCategories: ['name', 'email'], affectedCount: 1200, affectedRegions: ['IN'],
    organisation: 'Acme Pvt Ltd', contactName: 'Priya', contactEmail: 'dpo@acme.example',
  }, 'u1')

  test('the Board report is due 72 hours after the breach was discovered; changing that moves it', async () => {
    const i = await create()
    assert.equal(i.status, 'open')
    assert.equal(Date.parse(i.dueAt!) - Date.parse(discovered), 72 * HOUR)
    const earlier = new Date(Date.parse(discovered) - 5 * HOUR).toISOString()
    const u = await breaches.update('default', i.id, { discoveredAt: earlier, status: 'contained' }, 'u2')
    assert.equal(Date.parse(u.dueAt!) - Date.parse(earlier), 72 * HOUR)
    assert.equal(u.status, 'contained')
    assert.deepEqual(u.data.history.map(h => h.action), ['created', 'updated', 'status'])
    const closed = await breaches.update('default', i.id, { status: 'closed' }, 'u2')
    assert.ok(closed.data.closedAt)
    await assert.rejects(breaches.update('default', i.id, { status: 'gone' }, 'u2'), /status/)
    await assert.rejects(breaches.update('other', i.id, {}, 'u2'), (e: unknown) => e instanceof BreachError && e.status === 404)
  })

  test('reminders: one per run at 48h, 24h, 6h and overdue; none after the report is sent', async () => {
    const events: BreachDeadlineEvent[] = []
    bus.on('breach:deadline', (e: BreachDeadlineEvent) => events.push(e))
    const i = await create()
    const at = (hoursAfterDiscovery: number) => new Date(Date.parse(discovered) + hoursAfterDiscovery * HOUR)
    assert.equal((await breaches.runReminders(at(10))).length, 0)
    assert.deepEqual((await breaches.runReminders(at(30))).map(e => e.threshold), ['48h'])
    assert.equal((await breaches.runReminders(at(31))).length, 0, 'not repeated')
    assert.deepEqual((await breaches.runReminders(at(70))).map(e => e.threshold), ['6h'], 'skips straight to the most urgent')
    assert.equal((await breaches.runReminders(at(71))).length, 0, '24h is not sent late')
    assert.deepEqual((await breaches.runReminders(at(73))).map(e => e.threshold), ['overdue'])
    assert.deepEqual(events.map(e => e.threshold), ['48h', '6h', 'overdue'])
    assert.equal(events[0]!.incidentId, i.id)

    const j = await create()
    await breaches.markMilestone('default', j.id, 'boardReportSentAt', null, 'u1')
    assert.equal((await breaches.runReminders(at(73))).filter(e => e.incidentId === j.id).length, 0)
  })

  test('milestones are recorded with their time', async () => {
    const i = await create()
    const when = new Date(Date.now() - 10 * 60_000).toISOString()
    const m = await breaches.markMilestone('default', i.id, 'boardIntimatedAt', when, 'u1')
    assert.equal(m.data.boardIntimatedAt, when)
    await assert.rejects(breaches.markMilestone('default', i.id, 'sentToPress' as never, null, 'u1'), /milestone/)
  })

  test('DRAFT notices come from the template files, per language with an English fallback', async () => {
    const i = await create()
    const board = await breaches.draftNotice('default', i.id, 'board-intimation', 'en', 'u1')
    assert.ok(board.text.startsWith(BREACH_DRAFT_LABEL))
    assert.match(board.text, /Acme Pvt Ltd/)
    assert.match(board.text, /name, email/)
    assert.match(board.text, /1200/)
    assert.match(board.text, /\[to be completed\]/, 'empty fields are marked')
    assert.doesNotMatch(board.text, /\{\{/)

    const hi = await breaches.draftNotice('default', i.id, 'user-notice', 'hi', 'u1')
    assert.equal(hi.template, 'user-notice.hi.md')
    assert.match(hi.text, /प्रिय उपयोगकर्ता/)
    const fallback = await breaches.draftNotice('default', i.id, 'board-report', 'ta', 'u1')
    assert.equal(fallback.template, 'board-report.en.md')

    writeFileSync(join(customDir, 'user-notice.en.md'), 'Our own words for {{organisation}}.')
    const custom = await breaches.draftNotice('default', i.id, 'user-notice', 'en', 'u1')
    assert.equal(custom.text, `${BREACH_DRAFT_LABEL}\n\nOur own words for Acme Pvt Ltd.`)
    await assert.rejects(breaches.draftNotice('default', i.id, 'press-release' as never, 'en', 'u1'), /kind/)
    // An unsafe locale falls back to English rather than reading outside the folder.
    assert.equal((await breaches.draftNotice('default', i.id, 'board-report', '../../etc', 'u1')).template, 'board-report.en.md')
    const latest = (await breaches.get('default', i.id))!
    assert.equal(latest.data.history.filter(h => h.action === 'notice_drafted').length, 5)
  })

  test('admin routes: permissions, create, list, notices, export', async () => {
    const routes = buildAdminBreachRoutes(storage, { mode: 'jwt' }, SECRET, breaches) as Record<string, (r: Request, p: Record<string, string>) => Promise<Response>>
    const call = (key: string, path: string, perms: string[], body?: unknown, params: Record<string, string> = {}) => routes[key]!(new Request(`http://localhost/x${path}`, {
      method: key.split(' ')[0]!,
      headers: { authorization: `Bearer ${signJwt({ sub: 'admin-1', email: 'a@example.test', roles: [], permissions: perms, allowedTenants: [] }, SECRET)}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), params)

    assert.equal((await call('POST /incidents', '/incidents', ['audit:view'], { title: 'x' })).status, 403)
    assert.equal((await call('POST /incidents', '/incidents', ['settings:update'], { title: 'x' })).status, 400)
    let res = await call('POST /incidents', '/incidents', ['settings:update'], { title: 'Lost laptop', description: 'Unencrypted laptop lost', discoveredAt: new Date().toISOString(), severity: 'medium' })
    assert.equal(res.status, 201)
    const created = await res.json() as BreachIncident
    res = await call('GET /incidents', '/incidents?status=open', ['audit:view'])
    assert.equal((await res.json() as { total: number }).total, 1)
    assert.equal((await call('GET /incidents', '/incidents?status=nope', ['audit:view'])).status, 400)
    res = await call('POST /incidents/:id/notices', `/incidents/${created.id}/notices`, ['audit:view'], { kind: 'board-report' }, { id: created.id })
    assert.match((await res.json() as { text: string }).text, /Lost laptop/)
    res = await call('POST /incidents/:id/milestones', `/incidents/${created.id}/milestones`, ['settings:update'], { milestone: 'usersNotifiedAt' }, { id: created.id })
    assert.ok((await res.json() as BreachIncident).data.usersNotifiedAt)
    res = await call('GET /export/incidents', '/export/incidents', ['export:run'])
    const csv = await res.text()
    assert.match(csv, /^id,created_at,status,severity,title/)
    assert.equal(csv.trim().split('\n').length, 2)
    assert.equal((await call('GET /incidents/:id', `/incidents/nope`, ['audit:view'], undefined, { id: 'nope' })).status, 404)
  })
})
