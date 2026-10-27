import { useEffect, useState } from 'preact/hooks'
import type { Tenant } from '@consenti/types'
import { useT } from '../context/locale'
import { apiFetch, getSite, setSite } from '../api/client'

/**
 * Chooses which site the dashboard works on. Every admin request then carries `?tenantId=` for
 * that site (see `api/client.ts`); the server checks it against the user's allowed sites. Hidden
 * when the user can see only one site.
 */
export function SitePicker() {
  const t = useT()
  const [sites, setSites] = useState<Tenant[]>([])
  const current = getSite()

  useEffect(() => {
    apiFetch<Tenant[]>('/tenants')
      .then(list => {
        setSites(list)
        if (list.length > 0 && !list.some(s => s.id === current)) {
          setSite(list.some(s => s.id === 'default') ? 'default' : list[0]!.id)
          window.location.reload()
        }
      })
      .catch(() => setSites([]))
  }, [])

  if (sites.length < 2) return null

  const change = (id: string) => {
    if (id === current) return
    setSite(id)
    window.location.reload()
  }

  return (
    <label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      {t('layout.site')}
      <select
        value={current}
        onChange={e => change((e.currentTarget as HTMLSelectElement).value)}
        class="text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
      >
        {sites.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
      </select>
    </label>
  )
}
