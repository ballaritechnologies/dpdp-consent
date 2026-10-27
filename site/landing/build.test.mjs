// node --test site/landing/build.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, validEndpoint } from './build.mjs'

const FORBIDDEN = /\b(non-?compliant|compliant|certified|guaranteed?|legally valid)\b/i

test('injects the endpoint from the environment, never a hard-coded one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-'))
  try {
    const { html, hasForm } = await build({ endpoint: 'https://forms.example/ijazat', outDir: dir })
    assert.equal(hasForm, true)
    assert.match(html, /action="https:\/\/forms\.example\/ijazat"/)
    assert.match(html, /id="w-consent" name="consent" type="checkbox" required>/, 'consent box is not pre-ticked')
    assert.doesNotMatch(html, /__REPO_URL__|<!--WAITLIST/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('without an endpoint there is no form and no script', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-'))
  try {
    const { html, hasForm } = await build({ endpoint: '', outDir: dir })
    assert.equal(hasForm, false)
    assert.doesNotMatch(html, /<form|<script/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('rejects non-https endpoints', () => {
  assert.throws(() => validEndpoint('http://forms.example'))
  assert.throws(() => validEndpoint('javascript:alert(1)'))
  assert.equal(validEndpoint('http://localhost:8787/w'), 'http://localhost:8787/w')
})

test('no compliance claims and no third-party resources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-'))
  try {
    const { html } = await build({ endpoint: 'https://forms.example/ijazat', outDir: dir })
    assert.doesNotMatch(html, FORBIDDEN)
    assert.doesNotMatch(html, /<link[^>]+href="https?:|<script[^>]+src=|<img[^>]+src="https?:|@import/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
