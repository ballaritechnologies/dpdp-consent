/**
 * DPDP notice block rendered inside the banner and the preference modal for `opt-in-dpdpa`
 * profiles: the visible draft label, the separate purposes (banner), the Data Fiduciary, the
 * grievance contact, how to withdraw, and the notice version (modal).
 *
 * Built with DOM methods and `textContent` only — no `innerHTML` — because every value here comes
 * from site configuration. Labels come from `resolveDpdpLabels()` (data in @consenti/utils).
 */

import { resolveDpdpLabels } from '@consenti/utils'
import type { CategoryMap, DpdpaConfig, DpdpLabels } from '../types'

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

export interface DpdpNoticeOptions {
  variant: 'banner' | 'modal'
  locale: string
  config?: DpdpaConfig | undefined
  /** Banner only: the profile's categories, listed one purpose per line. */
  categories?: CategoryMap | undefined
}

export function isDpdpNoticeDraft(config?: DpdpaConfig): boolean {
  return config?.noticeStatus !== 'reviewed'
}

export function dpdpLabelsFor(locale: string, config?: DpdpaConfig): DpdpLabels {
  return resolveDpdpLabels(locale, config?.labels)
}

export function safeGrievanceEmail(value: string | undefined): string | null {
  const v = value?.trim() ?? ''
  return EMAIL.test(v) ? v : null
}

export function safeGrievanceUrl(value: string | undefined): string | null {
  const v = value?.trim() ?? ''
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function buildDpdpNotice(opts: DpdpNoticeOptions): HTMLElement {
  const { variant, locale, config, categories } = opts
  const labels = dpdpLabelsFor(locale, config)
  const root = el('div', `consenti-dpdp consenti-dpdp--${variant}`)
  root.setAttribute('data-consenti-dpdp', variant)

  if (isDpdpNoticeDraft(config)) {
    const draft = el('p', 'consenti-dpdp__draft', labels.draftBadge)
    draft.setAttribute('role', 'note')
    root.appendChild(draft)
  }

  if (variant === 'banner' && categories && Object.keys(categories).length > 0) {
    const listId = `consenti-dpdp-purposes-${variant}`
    const intro = el('p', 'consenti-dpdp__purposes-label', labels.purposes)
    intro.id = `${listId}-label`
    root.appendChild(intro)
    const list = el('ul', 'consenti-dpdp__purposes')
    list.setAttribute('aria-labelledby', intro.id)
    for (const category of Object.values(categories)) {
      const item = el('li', 'consenti-dpdp__purpose', category.heading)
      if (category.legalBasis === 'mandatory') {
        item.appendChild(el('span', 'consenti-dpdp__purpose-note', ` (${labels.purposeAlwaysOn})`))
      }
      list.appendChild(item)
    }
    root.appendChild(list)
  }

  if (config?.dataFiduciary) {
    const fiduciary = el('p', 'consenti-dpdp__fiduciary')
    fiduciary.appendChild(el('strong', '', `${labels.dataFiduciary}: `))
    fiduciary.appendChild(document.createTextNode(config.dataFiduciary))
    if (config.purposeDescription) fiduciary.appendChild(document.createTextNode(` — ${config.purposeDescription}`))
    root.appendChild(fiduciary)
  }

  const email = safeGrievanceEmail(config?.grievanceEmail)
  const url = safeGrievanceUrl(config?.grievanceUrl)
  if (email || url) {
    const grievance = el('p', 'consenti-dpdp__grievance', `${labels.grievance} `)
    if (config?.grievanceOfficer) grievance.appendChild(document.createTextNode(`${config.grievanceOfficer}, `))
    if (email) {
      const a = el('a', 'consenti-dpdp__grievance-email', email)
      a.href = `mailto:${email}`
      grievance.appendChild(a)
    }
    if (url) {
      if (email) grievance.appendChild(document.createTextNode(' · '))
      const a = el('a', 'consenti-dpdp__grievance-url', labels.grievanceLink)
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      grievance.appendChild(a)
    }
    root.appendChild(grievance)
  }

  root.appendChild(el('p', 'consenti-dpdp__withdraw', labels.withdraw))

  if (variant === 'modal' && config?.noticeVersion) {
    root.appendChild(el('p', 'consenti-dpdp__version', `${labels.noticeVersion}: ${config.noticeVersion}`))
  }

  return root
}
