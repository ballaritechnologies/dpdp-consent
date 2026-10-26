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
    description: 'The union of DPDP and GDPR requirements for every visitor. Not implemented yet.',
    implemented: false,
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
 * Throws {@link RegimeNotImplementedError} for `strictest_global`.
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
      throw new RegimeNotImplementedError(regime)
  }
}
