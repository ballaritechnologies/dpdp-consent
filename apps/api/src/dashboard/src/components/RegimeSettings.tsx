import { useEffect, useState } from 'preact/hooks'
import type { ComplianceGroupId, Regime, Tenant, TenantSettings } from '@consenti/types'
import { COMPLIANCE_GROUPS, COMPLIANCE_GROUP_IDS, DEFAULT_REGIME_FALLBACK_GROUP } from '@consenti/utils'
import { useT } from '../context/locale'
import { apiErrorMessage, apiFetch } from '../api/client'
import { Select } from './Select'

const NONE = ''

/** Per-site consent regime (`TenantSettings.regime`). `strictest_global` is not offered until the
 * API accepts it. */
export function RegimeSettings() {
  const t = useT()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantId, setTenantId] = useState('default')
  const [regime, setRegime] = useState<Regime | typeof NONE>(NONE)
  const [defaultGroup, setDefaultGroup] = useState<ComplianceGroupId>(DEFAULT_REGIME_FALLBACK_GROUP)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch<Tenant[]>('/tenants').then(setTenants).catch(() => setTenants([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    setStatus(null)
    apiFetch<TenantSettings>(`/settings?tenantId=${encodeURIComponent(tenantId)}`)
      .then(s => {
        setRegime(s.regime ?? NONE)
        setDefaultGroup(s.regimeDefaultGroup ?? DEFAULT_REGIME_FALLBACK_GROUP)
      })
      .catch(err => setStatus({ ok: false, text: apiErrorMessage(err, t('settings.regime.errorSave')) }))
      .finally(() => setLoading(false))
  }, [tenantId])

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await apiFetch(`/settings?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          regime: regime === NONE ? null : regime,
          regimeDefaultGroup: regime === 'dpdp_gdpr' ? defaultGroup : null,
        }),
      })
      setStatus({ ok: true, text: t('settings.regime.saved') })
    } catch (err) {
      setStatus({ ok: false, text: apiErrorMessage(err, t('settings.regime.errorSave')) })
    } finally {
      setSaving(false)
    }
  }

  const regimeOptions = [
    { value: NONE, label: t('settings.regime.none') },
    { value: 'dpdp', label: t('settings.regime.dpdp') },
    { value: 'dpdp_gdpr', label: t('settings.regime.dpdpGdpr') },
  ]
  const groupOptions = COMPLIANCE_GROUP_IDS.map(id => ({ value: id, label: COMPLIANCE_GROUPS[id].label }))
  const tenantOptions = tenants.map(tn => ({ value: tn.id, label: tn.name }))

  return (
    <div class="bg-white rounded-lg border border-gray-200 p-5">
      <h2 class="text-sm font-semibold text-gray-700 mb-1">{t('settings.regime.heading')}</h2>
      <p class="text-xs text-gray-500 mb-4">{t('settings.regime.hint')}</p>

      <div class="space-y-3">
        {tenantOptions.length > 1 && (
          <div>
            <label for="regime-site" class="block text-xs font-medium text-gray-600 mb-1">{t('settings.regime.site')}</label>
            <Select id="regime-site" options={tenantOptions} value={tenantId} onChange={setTenantId} searchable={tenantOptions.length > 8} />
          </div>
        )}

        <div>
          <label for="regime-select" class="block text-xs font-medium text-gray-600 mb-1">{t('settings.regime.label')}</label>
          <Select
            id="regime-select"
            options={regimeOptions}
            value={regime}
            onChange={v => { setRegime(v as Regime | typeof NONE); setStatus(null) }}
            disabled={loading}
          />
          {regime === 'dpdp' && <p class="text-xs text-gray-500 mt-1">{t('settings.regime.dpdpHint')}</p>}
          {regime === 'dpdp_gdpr' && <p class="text-xs text-gray-500 mt-1">{t('settings.regime.dpdpGdprHint')}</p>}
        </div>

        {regime === 'dpdp_gdpr' && (
          <div>
            <label for="regime-default" class="block text-xs font-medium text-gray-600 mb-1">{t('settings.regime.defaultGroup')}</label>
            <Select
              id="regime-default"
              options={groupOptions}
              value={defaultGroup}
              onChange={v => { setDefaultGroup(v as ComplianceGroupId); setStatus(null) }}
              disabled={loading}
            />
          </div>
        )}

        <p class="text-xs text-gray-400">{t('settings.regime.strictestSoon')}</p>
        <p class="text-xs text-amber-700">{t('settings.regime.notLegalAdvice')}</p>

        <div class="flex items-center gap-3">
          <button
            onClick={save}
            disabled={loading || saving}
            class="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
          {status && (
            <span role="status" class={`text-xs ${status.ok ? 'text-green-700' : 'text-red-600'}`}>{status.text}</span>
          )}
        </div>
      </div>
    </div>
  )
}
