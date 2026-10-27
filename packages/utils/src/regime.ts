/**
 * Per-site consent regimes — a routing policy applied in front of the country → compliance-group
 * lookup in `EMBEDDED_COMPLIANCE_MAP`. A regime does not add a new compliance group; it decides
 * which existing group a visitor is routed to. A site with no regime set keeps the plain
 * jurisdiction-map routing exactly as before.
 *
 * The `Regime` literal type derived from `REGIME_IDS` lives in @consenti/types
 * (packages/types/src/compliance.ts) via a type-only import, like `ComplianceGroupId`.
 */

import { COMPLIANCE_GROUP_IDS } from './compliance.js'

export const REGIME_IDS = ['dpdp', 'dpdp_gdpr', 'strictest_global'] as const

type RegimeId = typeof REGIME_IDS[number]
type ComplianceGroupId = typeof COMPLIANCE_GROUP_IDS[number]

export const REGIMES: Record<RegimeId, { label: string; description: string; implemented: boolean }> = {
  // TODO(legal): whether the DPDP flow alone is enough for non-Indian visitors, e.g. EU visitors
  // (docs/legal-open-questions.md, Q-R1).
  dpdp: {
    label: 'DPDP for everyone',
    description: "Every visitor gets the India DPDP consent flow ('opt-in-dpdpa'), wherever they are.",
    implemented: true,
  },
  dpdp_gdpr: {
    label: 'DPDP + GDPR by country',
    description: "India → DPDP flow, EU/EEA/UK → GDPR flow ('opt-in'), everyone else → the configured default group.",
    implemented: true,
  },
  strictest_global: {
    label: 'Strictest of both, for everyone',
    description: 'Every visitor gets the DPDP flow, hardened with GDPR-side protections: the Global Privacy Control signal is honoured for advertising, and consent expires after at most a year.',
    implemented: true,
  },
}

export const DPDP_GROUP = 'opt-in-dpdpa' satisfies ComplianceGroupId
export const GDPR_GROUP = 'opt-in' satisfies ComplianceGroupId

/** Group for `dpdp_gdpr` visitors outside India and the GDPR area when no default is configured,
 * and for visitors whose country could not be resolved at all.
 * TODO(legal): confirm the GDPR-style flow is the right fallback for an unknown location
 * (docs/legal-open-questions.md, Q-R3). */
export const DEFAULT_REGIME_FALLBACK_GROUP: ComplianceGroupId = GDPR_GROUP

/** EU-27 + EEA (Iceland, Liechtenstein, Norway) + United Kingdom. Both `GB` (ISO, what geo
 * providers return) and `UK` (the key `EMBEDDED_COMPLIANCE_MAP` uses) are listed. Switzerland is
 * deliberately absent — it is neither EU/EEA nor UK, so it takes the configured default group.
 * TODO(legal): confirm the country list, including Switzerland and overseas territories
 * (docs/legal-open-questions.md, Q-R2). */
export const GDPR_REGIME_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'UK',
])

export class RegimeNotImplementedError extends Error {
  constructor(readonly regime: RegimeId) {
    super(`Regime "${regime}" is not implemented`)
    this.name = 'RegimeNotImplementedError'
  }
}

export function isRegimeId(value: unknown): value is RegimeId {
  return typeof value === 'string' && (REGIME_IDS as readonly string[]).includes(value)
}

export function isComplianceGroupId(value: unknown): value is ComplianceGroupId {
  return typeof value === 'string' && (COMPLIANCE_GROUP_IDS as readonly string[]).includes(value)
}

/**
 * Compliance group a visitor from `country` is routed to under `regime`. `country` is whatever the
 * geo provider returned — `''` (or anything unrecognisable) means the location is unknown.
 * `strictest_global` sends everyone to the DPDP flow; see {@link regimeHardening} for what it adds.
 */
export function resolveRegimeGroup(
  regime: RegimeId,
  country: string,
  defaultGroup: ComplianceGroupId = DEFAULT_REGIME_FALLBACK_GROUP,
): ComplianceGroupId {
  switch (regime) {
    case 'dpdp':
      return DPDP_GROUP
    case 'dpdp_gdpr': {
      const code = country.trim().toUpperCase()
      if (code === 'IN') return DPDP_GROUP
      if (GDPR_REGIME_COUNTRIES.has(code)) return GDPR_GROUP
      return defaultGroup
    }
    case 'strictest_global':
      return DPDP_GROUP
  }
}

/** Consent lifetime cap under `strictest_global`. TODO(legal): Q-R5 — confirm the period. */
export const STRICTEST_MAX_EXPIRY_DAYS = 365

/** Item purposes the Global Privacy Control signal switches off under `strictest_global`. */
export const STRICTEST_GPC_ITEM_PURPOSES: readonly string[] = ['marketing']

/**
 * What a regime adds on top of its compliance group's profile. Only `strictest_global` adds
 * anything: the DPDP flow already gives itemised, unbundled, nothing-pre-ticked consent with an
 * equal "Reject all", withdrawal control and no legitimate-interest basis; from the GDPR side it
 * adds honouring GPC (treated as a refusal of advertising) and a capped consent lifetime.
 * TODO(legal): Q-R5 — whether this is the full union of both laws' consent requirements.
 */
export interface RegimeHardening {
  gpcMode: 'honor'
  gpcItemPurposes: readonly string[]
  maxExpiryDays: number
}

export function regimeHardening(regime: unknown): RegimeHardening | null {
  return regime === 'strictest_global'
    ? { gpcMode: 'honor', gpcItemPurposes: STRICTEST_GPC_ITEM_PURPOSES, maxExpiryDays: STRICTEST_MAX_EXPIRY_DAYS }
    : null
}

interface HardenableProfile {
  gpcMode?: 'ignore' | 'honor' | 'strict'
  expiryDays?: number
  cookies: Record<string, { purpose?: string; listenGpc?: boolean }>
}

/** `profile` with the hardening applied: GPC honoured (never loosened from `strict`), the listed
 * item purposes listening to GPC, and `expiryDays` capped. */
export function hardenProfile<P extends HardenableProfile>(profile: P, h: RegimeHardening): P {
  const cookies: P['cookies'] = { ...profile.cookies }
  for (const [id, c] of Object.entries(cookies)) {
    if (h.gpcItemPurposes.includes(c.purpose ?? '')) (cookies as Record<string, unknown>)[id] = { ...c, listenGpc: true }
  }
  return {
    ...profile,
    cookies,
    gpcMode: profile.gpcMode === 'strict' ? 'strict' : h.gpcMode,
    expiryDays: Math.min(profile.expiryDays ?? h.maxExpiryDays, h.maxExpiryDays),
  }
}
