import type { EmbeddedProfile } from '../types.js'

// DRAFT - REQUIRES LEGAL REVIEW. Built-in DPDP notice template: every site should have this text
// reviewed by its own lawyer, then set `dpdpa.noticeStatus: 'reviewed'` to remove the visible
// draft label. TODO(legal): required notice contents (docs/legal-open-questions.md, Q-A1).
//
// Each purpose is its own category so consent is asked for — and can be withdrawn — one purpose
// at a time, never bundled. Nothing is pre-granted. Only `necessary` (legalBasis 'mandatory') is
// always on; it is never bundled with an optional purpose.
export const OPT_IN_DPDPA_EN_PROFILE: EmbeddedProfile = {
  complianceGroup: 'opt-in-dpdpa',
  gpcMode: 'ignore',
  defaultLocale: 'en',
  expiryDays: 365,
  cookies: {
    security_storage: { purpose: 'necessary', listenGpc: false },
    functionality_storage: { purpose: 'functional', listenGpc: false },
    personalization_storage: { purpose: 'preferences', listenGpc: false },
    analytics_storage: { purpose: 'analytics', listenGpc: false },
    ad_storage: { purpose: 'marketing', listenGpc: false },
  },
  translations: {
    en: {
      mainBanner: {
        position: 'bottom',
        heading: 'Your consent for how we use your personal data',
        htmlText:
          'We would like to use your personal data for the purposes listed here. Each purpose is optional and separate: you can agree to some, all or none, and the site works either way. You can change or withdraw your consent at any time.',
        showLocaleSwitcher: true,
        buttons: {
          'consent-all': { text: 'Accept all', style: 'primary', action: 'custom', cookies: '*' },
          'deny-all': { text: 'Reject all', style: 'primary', action: 'custom', cookies: '!' },
          'review-choices': { text: 'Choose purposes', style: 'secondary', action: 'manage' },
        },
      },
      preferenceModal: {
        position: 'right',
        heading: 'Choose what you consent to',
        subheading:
          'Each purpose below is listed separately. Switch on only the ones you agree to. All optional purposes start switched off.',
        htmlText:
          'You can give, change or withdraw consent for each purpose at any time from the "Privacy choices" button. Withdrawing consent does not affect processing that already took place.',
        buttons: {
          'save-choices': { text: 'Save my choices', style: 'primary', action: 'submit' },
          'consent-all': { text: 'Accept all', style: 'secondary', action: 'custom', cookies: '*' },
          'withdraw-all': { text: 'Reject all', style: 'secondary', action: 'custom', cookies: '!' },
        },
        categories: {
          necessary: {
            heading: 'Essential: running the site',
            htmlText:
              'Data: session and security identifiers. Purpose: keeping you signed in, protecting against fraud, and remembering these consent choices. Always on, because the site cannot work without it.',
            legalBasis: 'mandatory',
            cookies: ['security_storage'],
          },
          functional: {
            heading: 'Enhanced features',
            htmlText:
              'Data: feature settings and device information. Purpose: optional features such as embedded content and chat. Off unless you switch it on.',
            legalBasis: 'consent',
            cookies: ['functionality_storage'],
          },
          preferences: {
            heading: 'Remembering your preferences',
            htmlText:
              'Data: language, region and display choices. Purpose: personalising the site for you on later visits. Off unless you switch it on.',
            legalBasis: 'consent',
            cookies: ['personalization_storage'],
          },
          analytics: {
            heading: 'Measuring site use',
            htmlText:
              'Data: pages visited, clicks, device and approximate location. Purpose: understanding how the site is used so we can improve it. Off unless you switch it on.',
            legalBasis: 'consent',
            cookies: ['analytics_storage'],
          },
          marketing: {
            heading: 'Advertising',
            htmlText:
              'Data: browsing activity and advertising identifiers. Purpose: showing ads based on your interests and measuring them. Off unless you switch it on.',
            legalBasis: 'consent',
            cookies: ['ad_storage'],
          },
        },
      },
    },
  },
}
