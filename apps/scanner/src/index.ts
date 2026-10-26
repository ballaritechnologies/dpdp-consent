export { runScan } from './scan.js'
export { writeReport, hasBlockingFindings } from './report.js'
export { renderHtmlReport, writeHtmlReport } from './html-report.js'
export { buildSuggestedSetup } from './suggest.js'
export { generateScanId } from './scan-id.js'
export { scanDirPath } from './scan-dir.js'
export { classifyState } from './classify.js'
export {
  matchDomainKnowledge,
  DOMAIN_KNOWLEDGE_BASE,
  matchTrackerKnowledge,
  TRACKER_KNOWLEDGE_BASE,
  isSameSite,
  registrableDomainOf,
} from '../source-data/index.js'
export type { DomainKnowledgeEntry, TrackerKnowledgeEntry, MatchConfidence } from '../source-data/index.js'
export {
  detectBanner,
  detectBannerWithMethod,
  clickAcceptAll,
  clickRejectAll,
  clickBannerButtonByExactText,
  isKnownBannerLabel,
  listBannerButtons,
  openPreferencePanel,
  listPreferenceCategories,
  applyCategorySelection,
  savePreferences,
} from './banner-detect.js'
export { detectBlockingSuspicion } from './blocking-detect.js'
export { detectCnameCloaking } from './cname-detect.js'
export { detectTagManagers } from './tag-manager.js'

export type {
  ConsentState,
  Confidence,
  BannerDetectionMethod,
  BlockingSuspicion,
  TrackerFinding,
  CloakingFinding,
  FingerprintFinding,
  TagManagerFinding,
  PreferenceCategory,
  CategoryStateResult,
  InferredBannerAction,
  PageResult,
  ScanReport,
  ScanOptions,
  ScanProgressHandler,
  ScanRunControl,
} from './types.js'
export { CONSENT_STATES, DEFAULT_SCAN_OPTIONS } from './types.js'
export type {
  ComplianceSuggestion,
  SuggestedConsentTemplate,
  SuggestedUiTemplate,
  SuggestedSetup,
} from './suggest.js'

// DPDP consent checker
export { runDpdpCheck, writeDpdpReport } from './dpdp/run.js'
export type { DpdpCheckOptions, DpdpCheckResultBundle } from './dpdp/run.js'
export { evaluateDpdp, DPDP_CHECK_TITLES, DPDP_DISCLAIMER } from './dpdp/checks.js'
export { renderDpdpHtml } from './dpdp/html.js'
export { probeDpdpPage } from './dpdp/probe.js'
export type { DpdpPageProbe, DpdpGap, DpdpReport, DpdpCheckId, DpdpCheckResult, DpdpSeverity } from './dpdp/types.js'
export { visibleBannerText, listPreferenceCategoryStates } from './banner-detect.js'
