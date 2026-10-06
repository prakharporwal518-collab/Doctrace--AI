// Interface strings in English and Hindi (profile → preferred language).
import type { Lang } from '@/lib/types';

const STRINGS = {
  dashboard: { en: 'Dashboard', hi: 'डैशबोर्ड' },
  documents: { en: 'Documents', hi: 'दस्तावेज़' },
  threeWay: { en: 'Three-way match', hi: 'थ्री-वे मिलान' },
  radar: { en: 'Deadline radar', hi: 'समय-सीमा रडार' },
  compare: { en: 'Contract diff', hi: 'अनुबंध तुलना' },
  vendors: { en: 'Vendors', hi: 'विक्रेता' },
  audit: { en: 'Audit trail', hi: 'ऑडिट ट्रेल' },
  settings: { en: 'Settings', hi: 'सेटिंग्स' },
  upload: { en: 'Upload', hi: 'अपलोड' },
  signOut: { en: 'Sign out', hi: 'साइन आउट' },
  privacy: { en: 'Privacy mode', hi: 'गोपनीयता मोड' },
  extractions: { en: 'Extractions', hi: 'निकाले गए तथ्य' },
  anomalies: { en: 'Anomalies', hi: 'विसंगतियाँ' },
  missing: { en: 'Missing data', hi: 'अनुपस्थित जानकारी' },
  obligations: { en: 'Obligations', hi: 'दायित्व' },
  chat: { en: 'Ask', hi: 'पूछें' },
  docsProcessed: { en: 'Documents processed', hi: 'संसाधित दस्तावेज़' },
  anomaliesFound: { en: 'Anomalies found', hi: 'मिली विसंगतियाँ' },
  upcomingDeadlines: { en: 'Deadlines in 30 days', hi: '30 दिनों में समय-सीमाएँ' },
  avgTrust: { en: 'Average trust score', hi: 'औसत विश्वास स्कोर' },
  askPlaceholder: { en: 'Ask about this document…', hi: 'इस दस्तावेज़ के बारे में पूछें…' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang = 'en'): string {
  return STRINGS[key][lang] ?? STRINGS[key].en;
}
