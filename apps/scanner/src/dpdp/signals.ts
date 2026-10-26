/** Text and selector heuristics the DPDP checks look for on a page. Data only: extend a list to
 * recognise another CMP or language. Matching is case-insensitive substring unless noted. */

/** A persistent control that reopens consent choices after a decision (for withdrawal). */
export const WITHDRAWAL_LABELS: string[] = [
  'privacy choices', 'your privacy choices', 'cookie settings', 'cookie preferences',
  'privacy settings', 'privacy preferences', 'manage consent', 'manage cookies',
  'manage preferences', 'consent preferences', 'consent settings', 'change consent',
  'withdraw consent', 'change my choices', 'update cookie preferences', 'do not sell or share',
  'गोपनीयता विकल्प', 'सहमति प्रबंधित करें', 'ಗೌಪ್ಯತೆ ಆಯ್ಕೆಗಳು', 'గోప్యతా ఎంపికలు', 'தனியுரிமைத் தேர்வுகள்',
]

/** Floating "reopen" buttons of common CMPs (and Ijazat's own). */
export const WITHDRAWAL_SELECTORS: string[] = [
  '#consenti-dpdp-reopen',
  '#ot-sdk-btn-floating', '.ot-floating-button', '#ot-sdk-btn',
  '#CookiebotWidget',
  '.cky-btn-revisit-wrapper', '.cky-revisit-bottom-left',
  '.cmplz-manage-consent',
  '[data-cc="show-preferencesModal"]', '[data-cc="c-settings"]',
  '.osano-cm-widget',
  '#truste-show-consent',
  '.termly-display-preferences',
  '.iubenda-cs-preferences-link',
]

/** Signs of a grievance / data-protection contact. */
export const GRIEVANCE_KEYWORDS: string[] = [
  'grievance officer', 'grievance redressal', 'grievance', 'data protection officer', 'nodal officer',
  'शिकायत अधिकारी', 'शिकायत निवारण', 'शिकायत', 'ಕುಂದುಕೊರತೆ', 'ఫిర్యాదు', 'குறைதீர்ப்பு', 'புகார்',
]

/** Names (in English and in their own script) of Indian scheduled languages. */
export const INDIAN_LANGUAGE_NAMES: string[] = [
  'hindi', 'हिन्दी', 'हिंदी', 'kannada', 'ಕನ್ನಡ', 'telugu', 'తెలుగు', 'tamil', 'தமிழ்',
  'bengali', 'bangla', 'বাংলা', 'marathi', 'मराठी', 'gujarati', 'ગુજરાતી', 'punjabi', 'ਪੰਜਾਬੀ',
  'malayalam', 'മലയാളം', 'odia', 'oriya', 'ଓଡ଼ିଆ', 'assamese', 'অসমীয়া', 'urdu', 'اردو',
]

/** BCP 47 primary subtags of Indian scheduled languages (for hreflang / lang attributes). */
export const INDIAN_LANGUAGE_CODES: string[] = [
  'hi', 'kn', 'te', 'ta', 'bn', 'mr', 'gu', 'pa', 'ml', 'or', 'as', 'ur', 'sa', 'ks', 'sd', 'ne',
  'kok', 'mai', 'mni', 'sat', 'doi', 'brx',
]

/** Devanagari through Malayalam (incl. Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada). */
export const INDIC_SCRIPT = /[ऀ-ൿ]/

/** Text a "cookie wall" shows when the site is unusable without accepting optional purposes. */
export const WALL_TEXT: string[] = [
  'accept cookies to continue', 'accept all cookies to continue', 'you must accept',
  'please accept cookies', 'consent is required to', 'accept to continue', 'to continue, accept',
  'cookies must be accepted',
]
