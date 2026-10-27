/**
 * Children's data: what a visitor who answered the age gate as under its minimum age may consent
 * to. Shared by the widget (so trackers never start client-side) and the server (so a crafted
 * request can't grant them either).
 *
 * - Until a parent's consent is verified, every optional purpose is denied.
 * - Blocked purposes (tracking, behavioural monitoring, targeted advertising) stay denied even
 *   after verification: the profile's `ageGate.blockedPurposes`, or by default every category
 *   holding an item whose `purpose` is `analytics` or `marketing`.
 *
 * TODO(legal): Q-C1 to Q-C3 — the age threshold, which purposes count as tracking or behavioural
 * monitoring, and exemptions (docs/legal-open-questions.md).
 */

import { buildCookieCategoryIndex, isMandatoryCookie } from './compliance.js'

/** Under the DPDP Act a child is anyone under 18 (s.2(f)). */
export const DPDP_CHILD_AGE = 18

/** Item purposes blocked for children unless `ageGate.blockedPurposes` says otherwise. */
export const DEFAULT_MINOR_BLOCKED_ITEM_PURPOSES: readonly string[] = ['analytics', 'marketing']

/** Minor status recorded in the consent cookie (`m`): 1 = parental consent pending, 2 = verified. */
export const MINOR_PENDING = 1
export const MINOR_PARENT_VERIFIED = 2
export type MinorCookieStatus = typeof MINOR_PENDING | typeof MINOR_PARENT_VERIFIED

interface MinorCategory {
  legalBasis: 'mandatory' | 'consent' | 'legitimate_interest'
  cookies: string[]
}

interface MinorItem {
  purpose?: string
}

/** Category IDs never granted to a child (mandatory categories are never listed). */
export function purposesBlockedForMinors(
  categories: Record<string, MinorCategory>,
  items: Record<string, MinorItem>,
  blockedPurposes?: readonly string[],
): string[] {
  return Object.entries(categories)
    .filter(([id, cat]) => cat.legalBasis !== 'mandatory' && (blockedPurposes
      ? blockedPurposes.includes(id)
      : cat.cookies.some(c => DEFAULT_MINOR_BLOCKED_ITEM_PURPOSES.includes(items[c]?.purpose ?? ''))))
    .map(([id]) => id)
}

/**
 * Returns `consent` with everything a child may not grant set to `'denied'`, plus the item IDs
 * that changed. Mandatory items are left alone; items in no category count as optional.
 */
export function restrictConsentForMinor<V extends string>(
  consent: Record<string, V | 'denied'>,
  categories: Record<string, MinorCategory>,
  items: Record<string, MinorItem>,
  parentVerified: boolean,
  blockedPurposes?: readonly string[],
): { consent: Record<string, V | 'denied'>; changed: string[] } {
  const index = buildCookieCategoryIndex(categories)
  const blockedItems = new Set<string>()
  for (const id of purposesBlockedForMinors(categories, items, blockedPurposes)) {
    for (const c of categories[id]?.cookies ?? []) blockedItems.add(c)
  }
  if (!blockedPurposes) {
    for (const [id, item] of Object.entries(items)) {
      if (!index.has(id) && DEFAULT_MINOR_BLOCKED_ITEM_PURPOSES.includes(item.purpose ?? '')) blockedItems.add(id)
    }
  }
  const out: Record<string, V | 'denied'> = { ...consent }
  const changed: string[] = []
  for (const [id, value] of Object.entries(consent)) {
    if (value === 'denied') continue
    if (index.has(id) && isMandatoryCookie(id, index)) continue
    if (!parentVerified || blockedItems.has(id)) {
      out[id] = 'denied'
      changed.push(id)
    }
  }
  return { consent: out, changed }
}
