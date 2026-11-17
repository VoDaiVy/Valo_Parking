import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import vi from './locales/vi.json';

const supportedLanguages = ['vi', 'en'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { vi: { translation: vi }, en: { translation: en } },
    fallbackLng: 'vi',
    supportedLngs: supportedLanguages,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'valo-language',
      caches: ['localStorage']
    },
    react: { useSuspense: false }
  });

export const normalizeLanguage = (value) => {
  const language = String(value || '').toLowerCase().split('-')[0];
  return supportedLanguages.includes(language) ? language : 'vi';
};

i18n.on('languageChanged', (language) => {
  const normalized = normalizeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = normalized;
  if (typeof document !== 'undefined') {
    document.title = i18n.t('seo.defaultTitle', { lng: normalized });
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', i18n.t('seo.defaultDescription', { lng: normalized }));
  }
});

if (typeof document !== 'undefined') {
  const initialLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  document.documentElement.lang = initialLanguage;
  document.title = i18n.t('seo.defaultTitle', { lng: initialLanguage });
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', i18n.t('seo.defaultDescription', { lng: initialLanguage }));
}

export default i18n;
