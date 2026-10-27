import type {
  ConsentDbRecord, ConsentVerifyResult, CreateConsentInput, UpdateConsentInput,
  ComplianceConfig, TcfConfig, GppConfig, CategoryMap, ConsentReceiptAction, CookieMap, ProfileConfig, StorageAdapter, PublicProfileResponse,
} from '@consenti/types'
import type { RecordProfileRef } from '../core/consent-engine'
import { buildConsentValue, verifyConsent, validateConsentInput, buildTcfPayload, buildConsentSignaturePayload } from '../core/consent-engine'
import { buildCookieCategoryIndex, encodeTcString, restrictConsentForMinor, isMandatoryCookie, regimeHardening } from '@consenti/utils'
import { getGvl } from '../tcf/gvl-cache'
import { encodeRealTcString } from '../tcf/real-tc-string'
import { isRegistrationConfirmed } from '../tcf/registration-confirmation'
import { encodeGppString } from '../gpp/gpp-string'
import { signHmac } from '../utils/crypto'
import type { ConsentRepo } from '../repositories/consent.repo'
import type { VisitorRepo } from '../repositories/visitor.repo'
import type { ProfileRepo } from '../repositories/profile.repo'
import type { AuditRepo } from '../repositories/audit.repo'
import type { PluginEngine } from '../core/plugin-engine'
import type { EventEmitter } from 'node:events'
import { applyCookiesOverride } from './profile.service'
import type { ReceiptWriter } from './receipt.service'

export class ConsentService {
  constructor(
    private consents: ConsentRepo,
    private visitors: VisitorRepo,
    private profiles: ProfileRepo,
    private audit: AuditRepo,
    private tenantId: string = 'default',
    private compliance?: ComplianceConfig,
    private pluginEngine?: PluginEngine,
    private eventBus?: EventEmitter,
    private tcfConfig?: TcfConfig,
    private storage?: StorageAdapter,
    private dataSigningHash?: string,
    private gppConfig?: GppConfig,
    private archivedSnapshot?: (profileId: string, version?: number) => Promise<PublicProfileResponse | null>,
    private receipts?: ReceiptWriter,
    private minors?: { isParentVerified(tenantId: string, visitorId: string): Promise<boolean> },
  ) { }

  /**
   * `strictest_global` honours the Global Privacy Control signal even on the DPDP flow: with GPC,
   * advertising items (and any item set to listen to GPC) are refused, on every write.
   */
  private async applyRegimeGpc(
    consent: ConsentDbRecord['consentJson'], gpc: boolean, cookies: CookieMap, categories: CategoryMap,
  ): Promise<ConsentDbRecord['consentJson']> {
    if (!gpc || !this.storage || this.compliance?.gpc === false) return consent
    const hardening = regimeHardening((await this.storage.getSettings(this.tenantId)).regime)
    if (!hardening) return consent
    const index = buildCookieCategoryIndex(categories)
    const out = { ...consent }
    for (const [id, cookie] of Object.entries(cookies)) {
      if (isMandatoryCookie(id, index)) continue
      if (cookie.listenGpc || hardening.gpcItemPurposes.includes(cookie.purpose ?? '')) out[id] = 'denied'
    }
    return out
  }

  /**
   * A child (a visitor who answered the age gate as under age): no optional purpose until a
   * parent's consent is verified, and never the blocked ones. Enforced here as well as in the
   * widget so a crafted request can't grant them.
   */
  private async restrictForMinor(
    visitorId: string, consent: ConsentDbRecord['consentJson'], pj: ProfileConfig, cookies: CookieMap, categories: CategoryMap,
  ): Promise<{ consent: ConsentDbRecord['consentJson']; parentVerified: boolean }> {
    const parentVerified = await this.minors?.isParentVerified(this.tenantId, visitorId) ?? false
    const restricted = restrictConsentForMinor(consent, categories, cookies, parentVerified, pj.ageGate?.blockedPurposes)
    return { consent: restricted.consent, parentVerified }
  }

  private sign(payload: { tenantId: string; visitorId: string; profileId: string; locale: string; consentJson: ConsentDbRecord['consentJson'] }): string | undefined {
    if (!this.dataSigningHash) return undefined
    return signHmac(buildConsentSignaturePayload(payload), this.dataSigningHash)
  }

  /** Fails closed: no `storage` to check against means unconfirmed, never assumed confirmed. */
  private async isTcfConfirmed(): Promise<boolean> {
    if (!this.tcfConfig?.enabled) return true
    if (!this.storage) return false
    const settings = await this.storage.getSettings(this.tenantId)
    return isRegistrationConfirmed(
      true,
      { cmpId: this.tcfConfig.cmpId, cmpVersion: this.tcfConfig.cmpVersion, publisherCC: this.tcfConfig.publisherCC },
      settings.tcfConfirmation,
    )
  }

  /** Same fail-closed shape as isTcfConfirmed() — see registration-confirmation.ts. */
  private async isGppConfirmed(): Promise<boolean> {
    if (!this.gppConfig?.enabled) return true
    if (!this.storage) return false
    const settings = await this.storage.getSettings(this.tenantId)
    return isRegistrationConfirmed(
      true,
      { cmpId: this.gppConfig.cmpId, cmpVersion: this.gppConfig.cmpVersion },
      settings.gppConfirmation,
    )
  }

  /**
   * Profiles created via the dashboard wizard reference a consent template (`consentTemplateId`)
   * rather than embedding `cookies`/`preferenceModal.categories` directly on `profileJson` — those
   * fields are only populated for the embedded/seeded default profiles (see
   * `ProfileService.seedDefaultProfile`). Cookie/category membership and `legalBasis` are
   * locale-independent, so the raw consent template's data is sufficient here — no need to
   * resolve per-locale text via `ProfileService.getResolved()`. Mirrors the same fallback
   * `ProfileService.getResolved()` and the admin route validators already apply.
   */
  private async resolveTemplateData(pj: ProfileConfig): Promise<{ cookies: CookieMap; categories: CategoryMap }> {
    const needsCookies = !pj.cookies
    const needsCategories = !pj.preferenceModal?.categories
    const ct = (needsCookies || needsCategories) && pj.consentTemplateId && this.storage
      ? await this.storage.getConsentTemplate(pj.consentTemplateId)
      : null
    return {
      cookies: pj.cookies ?? (ct ? applyCookiesOverride(ct.cookies, pj.cookiesOverride) : {}),
      categories: pj.preferenceModal?.categories ?? ct?.categories ?? {},
    }
  }

  async create(input: Omit<CreateConsentInput, 'tenantId'>): Promise<ConsentDbRecord> {
    const profile = await this.profiles.get(input.profileId)
    if (!profile) throw new Error(`Profile ${input.profileId} not found`)

    const regulation = profile.profileJson.regulation
    const { cookies: profileCookies, categories } = await this.resolveTemplateData(profile.profileJson)
    const categoryIndex = buildCookieCategoryIndex(categories)
    // GPC server-side enforcement — skip for DPDPA (no GPC opt-out signal recognised)
    let effectiveConsent = input.consentJson
    if (input.gpcDetected && this.compliance?.gpc !== false && regulation !== 'dpdpa') {
      effectiveConsent = { ...effectiveConsent }
      for (const [id, cookie] of Object.entries(profileCookies)) {
        if (regulation === 'cpra') {
          // CPRA: deny sale + sharing on GPC; sensitive stays as submitted
          if (cookie.cpraCategory === 'sale' || cookie.cpraCategory === 'sharing') {
            effectiveConsent[id] = 'denied'
          }
        } else if (cookie.listenGpc) {
          effectiveConsent[id] = 'denied'
        }
      }
    }

    const validation = validateConsentInput({ ...input, consentJson: effectiveConsent }, profileCookies, categoryIndex)
    if (!validation.valid) throw new Error(validation.errors.join('; '))

    let builtConsent = buildConsentValue(
      profileCookies,
      categoryIndex,
      effectiveConsent,
      input.gpcDetected,
      regulation,
    )

    builtConsent = await this.applyRegimeGpc(builtConsent, input.gpcDetected, profileCookies, categories)

    const existing = await this.consents.get(input.visitorId)
    const isMinor = (input.ageVerified ?? existing?.ageVerified) === false
    let parentVerified = false
    if (isMinor) {
      const r = await this.restrictForMinor(input.visitorId, builtConsent, profile.profileJson, profileCookies, categories)
      builtConsent = r.consent
      parentVerified = r.parentVerified
    }

    let tcfString: string | undefined
    const tcfConfig = this.tcfConfig
    const tcfRelevant = tcfConfig?.enabled && Object.values(profileCookies).some(c => c.tcfVendorId)
    const tcfConfirmed = tcfRelevant ? await this.isTcfConfirmed() : true
    if (tcfConfig && tcfRelevant && !tcfConfirmed) {
      console.error(
        `[Consenti] TCF is enabled (cmpId=${tcfConfig.cmpId}, cmpVersion=${tcfConfig.cmpVersion}) but this registration ` +
        'is unconfirmed — treating TCF as disabled for this consent write (no tcfString generated). ' +
        'Confirm the current cmpId/cmpVersion in the dashboard\'s TCF Registration panel to re-enable.',
      )
    } else if (tcfConfig && tcfRelevant) {
      const gvl = await getGvl()
      const { vendorConsents, purposeConsents } = buildTcfPayload(profileCookies, builtConsent)
      const consentLanguage = input.locale?.slice(0, 2) ?? 'en'

      tcfString = (tcfConfig.publisherCC && gvl)
        ? await encodeRealTcString({
          cmpId: tcfConfig.cmpId,
          cmpVersion: tcfConfig.cmpVersion,
          consentScreen: 1,
          consentLanguage,
          publisherCC: tcfConfig.publisherCC,
          isServiceSpecific: true,
          purposeConsents,
          vendorConsents,
          gvl,
        }) ?? undefined
        : undefined

      // Falls back to the simplified (non-spec) encoder when publisherCC/GVL aren't
      // available yet, or when the optional `@iabtechlabtcf/core` dependency isn't installed.
      if (!tcfString) {
        tcfString = encodeTcString({
          cmpId: tcfConfig.cmpId,
          cmpVersion: tcfConfig.cmpVersion,
          consentScreen: 1,
          consentLanguage,
          vendorListVersion: gvl?.vendorListVersion ?? 0,
          purposeConsents,
          vendorConsents,
        })
      }
    }

    let gppString: string | undefined
    const gppConfig = this.gppConfig
    const saleApplicable = Object.values(profileCookies).some(c => c.cpraCategory === 'sale')
    const sharingApplicable = Object.values(profileCookies).some(c => c.cpraCategory === 'sharing')
    const gppRelevant = gppConfig?.enabled && (saleApplicable || sharingApplicable)
    const gppConfirmed = gppRelevant ? await this.isGppConfirmed() : true
    if (gppConfig && gppRelevant && !gppConfirmed) {
      console.error(
        `[Consenti] GPP is enabled (cmpId=${gppConfig.cmpId}, cmpVersion=${gppConfig.cmpVersion}) but this registration ` +
        'is unconfirmed — treating GPP as disabled for this consent write (no gppString generated). ' +
        'Confirm the current cmpId/cmpVersion in the dashboard\'s GPP Registration panel to re-enable.',
      )
    } else if (gppConfig && gppRelevant) {
      const saleOptOut = !saleApplicable || Object.entries(profileCookies)
        .filter(([, c]) => c.cpraCategory === 'sale')
        .every(([id]) => builtConsent[id] !== 'granted')
      const sharingOptOut = !sharingApplicable || Object.entries(profileCookies)
        .filter(([, c]) => c.cpraCategory === 'sharing')
        .every(([id]) => builtConsent[id] !== 'granted')

      gppString = await encodeGppString({
        cmpId: gppConfig.cmpId,
        cmpVersion: gppConfig.cmpVersion,
        mspaCoveredTransaction: gppConfig.mspaCoveredTransaction,
        mspaOptOutOptionMode: gppConfig.mspaOptOutOptionMode,
        mspaServiceProviderMode: gppConfig.mspaServiceProviderMode,
        saleOptOut,
        saleApplicable,
        sharingOptOut,
        sharingApplicable,
        gpcDetected: input.gpcDetected,
      })
    }

    const signature = this.sign({
      tenantId: this.tenantId, visitorId: input.visitorId, profileId: input.profileId,
      locale: input.locale, consentJson: builtConsent,
    })

    let baseInput: CreateConsentInput = {
      ...input,
      tenantId: this.tenantId,
      consentJson: builtConsent,
      ...(tcfString ? { tcfString } : {}),
      ...(gppString ? { gppString } : {}),
      ...(signature ? { signature } : {}),
    }
    if (this.pluginEngine) baseInput = await this.pluginEngine.runBeforeConsentSave(baseInput)
    // After the plugin hook, so no plugin can drop it — with profileId it pins the exact snapshot shown.
    baseInput = { ...baseInput, profileVersion: profile.version }

    let record: ConsentDbRecord

    if (existing) {
      const updateData = await (this.pluginEngine
        ? this.pluginEngine.runBeforeConsentUpdate({ consentJson: builtConsent, locale: input.locale, gpcDetected: input.gpcDetected, ...(signature ? { signature } : {}) })
        : Promise.resolve({ consentJson: builtConsent, locale: input.locale, gpcDetected: input.gpcDetected, ...(signature ? { signature } : {}) }))
      record = await this.consents.update(input.visitorId, { ...updateData, profileVersion: profile.version })
    } else {
      record = await this.consents.create(baseInput)
    }

    await this.audit.log({
      tenantId: this.tenantId,
      action: existing ? 'consent:updated' : 'consent:created',
      resourceType: 'consent',
      resourceId: record.id,
      ...(existing != null ? { oldData: existing } : {}),
      newData: record,
    })

    await this.receipts?.record({
      tenantId: record.tenantId, visitorId: input.visitorId, action: existing ? 'updated' : 'given',
      record, profile, categories, previous: existing,
      ...(isMinor ? { minor: parentVerified ? 'parental_consent_verified' as const : 'parental_consent_pending' as const } : {}),
    })

    if (existing) {
      this.eventBus?.emit('consent:updated', { previous: existing, current: record })
      await this.pluginEngine?.runAfterConsentUpdate(record)
    } else {
      this.eventBus?.emit('consent:created', record)
      await this.pluginEngine?.runAfterConsentSave(record)
    }

    return record
  }

  /** `receipt` overrides what the consent receipt records (e.g. a purpose lapsing by retention). */
  async update(
    visitorId: string,
    input: UpdateConsentInput,
    receipt: { action?: ConsentReceiptAction; expiredPurposes?: string[] } = {},
  ): Promise<ConsentDbRecord> {
    const existing = await this.consents.get(visitorId)
    if (!existing) throw new Error(`Consent for visitor ${visitorId} not found`)

    const profile = await this.profiles.get(existing.profileId)
    if (!profile) throw new Error(`Profile ${existing.profileId} not found`)

    const regulation = profile.profileJson.regulation
    const { cookies: profileCookies2, categories: categories2 } = await this.resolveTemplateData(profile.profileJson)
    const categoryIndex2 = buildCookieCategoryIndex(categories2)
    const effectiveGpc = input.gpcDetected ?? existing.gpcDetected
    let effectiveConsent = input.consentJson
    if (effectiveGpc && this.compliance?.gpc !== false && regulation !== 'dpdpa') {
      effectiveConsent = { ...effectiveConsent }
      for (const [id, cookie] of Object.entries(profileCookies2)) {
        if (regulation === 'cpra') {
          if (cookie.cpraCategory === 'sale' || cookie.cpraCategory === 'sharing') {
            effectiveConsent[id] = 'denied'
          }
        } else if (cookie.listenGpc) {
          effectiveConsent[id] = 'denied'
        }
      }
    }

    let builtConsent = buildConsentValue(
      profileCookies2,
      categoryIndex2,
      effectiveConsent,
      effectiveGpc,
      regulation,
    )
    builtConsent = await this.applyRegimeGpc(builtConsent, effectiveGpc, profileCookies2, categories2)
    const isMinor = existing.ageVerified === false
    let parentVerified = false
    if (isMinor) {
      const r = await this.restrictForMinor(visitorId, builtConsent, profile.profileJson, profileCookies2, categories2)
      builtConsent = r.consent
      parentVerified = r.parentVerified
    }

    const signature = this.sign({
      tenantId: this.tenantId, visitorId, profileId: existing.profileId,
      locale: input.locale ?? existing.locale, consentJson: builtConsent,
    })

    const updatePayload: UpdateConsentInput = {
      consentJson: builtConsent,
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.gpcDetected !== undefined ? { gpcDetected: input.gpcDetected } : {}),
      ...(signature ? { signature } : {}),
    }
    const updateData = await (this.pluginEngine
      ? this.pluginEngine.runBeforeConsentUpdate(updatePayload)
      : Promise.resolve(updatePayload))
    const record = await this.consents.update(visitorId, { ...updateData, profileVersion: profile.version })
    await this.audit.log({
      tenantId: this.tenantId,
      action: 'consent:updated',
      resourceType: 'consent',
      resourceId: record.id,
      oldData: existing,
      newData: record,
    })
    await this.receipts?.record({
      tenantId: record.tenantId, visitorId, action: receipt.action ?? 'updated',
      record, profile, categories: categories2, previous: existing,
      ...(receipt.expiredPurposes ? { expiredPurposes: receipt.expiredPurposes } : {}),
      ...(isMinor ? { minor: parentVerified ? 'parental_consent_verified' as const : 'parental_consent_pending' as const } : {}),
    })
    this.eventBus?.emit('consent:updated', { previous: existing, current: record })
    await this.pluginEngine?.runAfterConsentUpdate(record)
    return record
  }

  /** The purposes (categories) of a profile, resolved through its consent template if needed. */
  async purposesFor(profileId: string): Promise<CategoryMap | null> {
    const profile = await this.profiles.get(profileId)
    if (!profile) return null
    return (await this.resolveTemplateData(profile.profileJson)).categories
  }

  get(visitorId: string): Promise<ConsentDbRecord | null> {
    return this.consents.get(visitorId)
  }

  async verify(visitorId: string): Promise<ConsentVerifyResult> {
    const record = await this.consents.get(visitorId)
    if (!record) return { valid: false, reasons: ['profile_changed'] }

    const row = await this.profiles.get(record.profileId)
    // A deleted profile's row is gone but its snapshots stay on disk; resolve to the newest one.
    const archived = row ? null : await this.archivedSnapshot?.(record.profileId, record.profileVersion) ?? null
    if (!row && !archived) return { valid: false, reasons: ['profile_changed'] }

    const recordProfile: RecordProfileRef = row
      ? { id: row.id, expiryDays: row.profileJson.expiryDays }
      : { id: record.profileId, expiryDays: archived?.expiryDays }
    const complianceGroup = row ? row.profileJson.complianceGroup : archived?.complianceGroup
    const activeProfile = complianceGroup ? await this.profiles.findActiveByComplianceGroup(this.tenantId, complianceGroup) : null

    return verifyConsent(record, recordProfile, activeProfile, this.dataSigningHash)
  }

  async erase(visitorId: string): Promise<void> {
    const existing = await this.consents.get(visitorId)
    await this.consents.delete(visitorId)
    await this.visitors.delete(visitorId)
    // The audit log keeps only a digest of what was erased, never the decisions themselves —
    // otherwise erasing a visitor would leave their consent record behind in the log.
    await this.audit.log({
      tenantId: this.tenantId,
      action: 'consent:erased',
      resourceType: 'consent',
      resourceId: visitorId,
      ...(existing != null ? {
        oldData: {
          consentRecordId: existing.id, profileId: existing.profileId,
          ...(existing.profileVersion !== undefined ? { profileVersion: existing.profileVersion } : {}),
          createdAt: existing.createdAt, updatedAt: existing.updatedAt,
        },
      } : {}),
    })
    if (existing) {
      const profile = await this.profiles.get(existing.profileId)
      await this.receipts?.record({
        tenantId: existing.tenantId, visitorId, action: 'erased', record: null, profile, categories: {}, previous: existing,
      })
    }
    this.eventBus?.emit('consent:erased', { visitorId })
  }
}
