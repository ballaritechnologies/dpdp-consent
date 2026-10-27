/**
 * Short UI labels the widget renders around a DPDP notice (draft label, fiduciary, grievance
 * contact, withdrawal hint, the persistent "Privacy choices" button). This is data: adding a
 * language means adding one entry below — or, per site, setting `dpdpa.labels[<locale>]` on the
 * profile — with no code change.
 *
 * DRAFT - REQUIRES LEGAL REVIEW. TODO(legal): the hi/kn/te/ta text was written without native-
 * speaker or legal review (docs/legal-open-questions.md, Q-D2).
 *
 * Structurally identical to `DpdpLabels` in @consenti/types (packages/utils can't import it).
 */
export interface DpdpLabelSet {
  draftBadge: string
  dataFiduciary: string
  purposes: string
  purposeAlwaysOn: string
  grievance: string
  grievanceLink: string
  withdraw: string
  noticeVersion: string
  reopenButton: string
  reopenAriaLabel: string
  /** On a purpose a child can never switch on (`ageGate.blockedPurposes`). */
  minorBlocked: string
  /** On optional purposes while a child's parental consent is pending. */
  parentalPending: string
}

/** Kept in English in every locale: the label is for the site owner and their lawyer as much as
 * for visitors, and must be unmistakable. */
export const DPDP_DRAFT_BADGE = 'DRAFT - REQUIRES LEGAL REVIEW'

export const DPDP_LABELS: Record<string, DpdpLabelSet> = {
  en: {
    draftBadge: DPDP_DRAFT_BADGE,
    dataFiduciary: 'Data Fiduciary',
    purposes: 'We ask for your consent separately for each purpose:',
    purposeAlwaysOn: 'always on, needed to provide the service',
    grievance: 'Questions or complaints? Contact our Grievance Officer:',
    grievanceLink: 'Grievance and contact page',
    withdraw: 'You can withdraw your consent at any time, as easily as you gave it, using the "Privacy choices" button on this site.',
    noticeVersion: 'Notice version',
    reopenButton: 'Privacy choices',
    reopenAriaLabel: 'Open privacy choices to review or withdraw your consent',
    minorBlocked: 'Not available for children',
    parentalPending: 'Off until a parent or guardian consents',
  },
  hi: {
    draftBadge: DPDP_DRAFT_BADGE,
    dataFiduciary: 'डेटा फ़िड्यूशियरी',
    purposes: 'हम हर उद्देश्य के लिए आपकी सहमति अलग से माँगते हैं:',
    purposeAlwaysOn: 'हमेशा चालू, सेवा देने के लिए आवश्यक',
    grievance: 'प्रश्न या शिकायत? हमारे शिकायत अधिकारी से संपर्क करें:',
    grievanceLink: 'शिकायत और संपर्क पेज',
    withdraw: 'आप इस साइट पर "गोपनीयता विकल्प" बटन से किसी भी समय अपनी सहमति उतनी ही आसानी से वापस ले सकते हैं, जितनी आसानी से आपने दी थी।',
    noticeVersion: 'सूचना संस्करण',
    reopenButton: 'गोपनीयता विकल्प',
    reopenAriaLabel: 'अपनी सहमति देखने या वापस लेने के लिए गोपनीयता विकल्प खोलें',
    minorBlocked: 'बच्चों के लिए उपलब्ध नहीं',
    parentalPending: 'माता-पिता या अभिभावक की सहमति तक बंद',
  },
  kn: {
    draftBadge: DPDP_DRAFT_BADGE,
    dataFiduciary: 'ಡೇಟಾ ಫಿಡ್ಯೂಷಿಯರಿ',
    purposes: 'ಪ್ರತಿ ಉದ್ದೇಶಕ್ಕೂ ನಾವು ನಿಮ್ಮ ಸಮ್ಮತಿಯನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ಕೇಳುತ್ತೇವೆ:',
    purposeAlwaysOn: 'ಯಾವಾಗಲೂ ಆನ್, ಸೇವೆ ಒದಗಿಸಲು ಅಗತ್ಯ',
    grievance: 'ಪ್ರಶ್ನೆಗಳು ಅಥವಾ ದೂರುಗಳಿವೆಯೇ? ನಮ್ಮ ಕುಂದುಕೊರತೆ ಅಧಿಕಾರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ:',
    grievanceLink: 'ಕುಂದುಕೊರತೆ ಮತ್ತು ಸಂಪರ್ಕ ಪುಟ',
    withdraw: 'ಈ ಸೈಟ್‌ನಲ್ಲಿರುವ "ಗೌಪ್ಯತೆ ಆಯ್ಕೆಗಳು" ಬಟನ್ ಬಳಸಿ, ನೀವು ಸಮ್ಮತಿ ನೀಡಿದಷ್ಟೇ ಸುಲಭವಾಗಿ ಯಾವಾಗ ಬೇಕಾದರೂ ಅದನ್ನು ಹಿಂಪಡೆಯಬಹುದು.',
    noticeVersion: 'ಸೂಚನೆಯ ಆವೃತ್ತಿ',
    reopenButton: 'ಗೌಪ್ಯತೆ ಆಯ್ಕೆಗಳು',
    reopenAriaLabel: 'ನಿಮ್ಮ ಸಮ್ಮತಿಯನ್ನು ಪರಿಶೀಲಿಸಲು ಅಥವಾ ಹಿಂಪಡೆಯಲು ಗೌಪ್ಯತೆ ಆಯ್ಕೆಗಳನ್ನು ತೆರೆಯಿರಿ',
    minorBlocked: 'ಮಕ್ಕಳಿಗೆ ಲಭ್ಯವಿಲ್ಲ',
    parentalPending: 'ಪೋಷಕರು ಅಥವಾ ರಕ್ಷಕರು ಸಮ್ಮತಿಸುವವರೆಗೆ ಆಫ್',
  },
  te: {
    draftBadge: DPDP_DRAFT_BADGE,
    dataFiduciary: 'డేటా ఫిడ్యూషియరీ',
    purposes: 'ప్రతి ప్రయోజనానికి మేము మీ సమ్మతిని విడిగా అడుగుతాము:',
    purposeAlwaysOn: 'ఎల్లప్పుడూ ఆన్‌లో ఉంటుంది, సేవ అందించడానికి అవసరం',
    grievance: 'ప్రశ్నలు లేదా ఫిర్యాదులు ఉన్నాయా? మా ఫిర్యాదుల అధికారిని సంప్రదించండి:',
    grievanceLink: 'ఫిర్యాదులు మరియు సంప్రదింపు పేజీ',
    withdraw: 'ఈ సైట్‌లోని "గోప్యతా ఎంపికలు" బటన్‌తో, మీరు సమ్మతి ఇచ్చినంత సులభంగానే ఎప్పుడైనా దాన్ని ఉపసంహరించుకోవచ్చు.',
    noticeVersion: 'నోటీసు వెర్షన్',
    reopenButton: 'గోప్యతా ఎంపికలు',
    reopenAriaLabel: 'మీ సమ్మతిని సమీక్షించడానికి లేదా ఉపసంహరించుకోవడానికి గోప్యతా ఎంపికలను తెరవండి',
    minorBlocked: 'పిల్లలకు అందుబాటులో లేదు',
    parentalPending: 'తల్లిదండ్రులు లేదా సంరక్షకులు సమ్మతించే వరకు ఆఫ్',
  },
  ta: {
    draftBadge: DPDP_DRAFT_BADGE,
    dataFiduciary: 'தரவு நம்பகப் பொறுப்பாளர்',
    purposes: 'ஒவ்வொரு நோக்கத்திற்கும் உங்கள் ஒப்புதலைத் தனித்தனியாகக் கேட்கிறோம்:',
    purposeAlwaysOn: 'எப்போதும் இயக்கத்தில், சேவையை வழங்கத் தேவை',
    grievance: 'கேள்விகள் அல்லது புகார்கள் உள்ளதா? எங்கள் குறைதீர்ப்பு அதிகாரியைத் தொடர்புகொள்ளவும்:',
    grievanceLink: 'குறைதீர்ப்பு மற்றும் தொடர்புப் பக்கம்',
    withdraw: 'இந்தத் தளத்தில் உள்ள "தனியுரிமைத் தேர்வுகள்" பொத்தானைப் பயன்படுத்தி, ஒப்புதல் அளித்த அதே எளிமையுடன் எப்போது வேண்டுமானாலும் அதைத் திரும்பப் பெறலாம்.',
    noticeVersion: 'அறிவிப்புப் பதிப்பு',
    reopenButton: 'தனியுரிமைத் தேர்வுகள்',
    reopenAriaLabel: 'உங்கள் ஒப்புதலைப் பார்க்க அல்லது திரும்பப் பெற தனியுரிமைத் தேர்வுகளைத் திறக்கவும்',
    minorBlocked: 'குழந்தைகளுக்குக் கிடைக்காது',
    parentalPending: 'பெற்றோர் அல்லது பாதுகாவலர் ஒப்புதல் அளிக்கும் வரை முடக்கப்பட்டுள்ளது',
  },
}

/**
 * Labels for `locale`: exact match (`hi-IN`), then its language (`hi`), then English — with the
 * site's own `overrides` for that locale (or its language) layered on top. The draft badge can
 * never be overridden: removing it is done by marking the notice reviewed, not by relabelling it.
 */
export function resolveDpdpLabels(
  locale: string,
  overrides?: Record<string, Partial<DpdpLabelSet>>,
): DpdpLabelSet {
  const lang = locale.split('-')[0] ?? locale
  const base = DPDP_LABELS[locale] ?? DPDP_LABELS[lang] ?? DPDP_LABELS['en']!
  const own = overrides?.[locale] ?? overrides?.[lang] ?? {}
  const merged: DpdpLabelSet = { ...base }
  for (const key of Object.keys(merged) as Array<keyof DpdpLabelSet>) {
    const value = own[key]
    if (typeof value === 'string' && value.trim() !== '') merged[key] = value
  }
  merged.draftBadge = DPDP_DRAFT_BADGE
  return merged
}
