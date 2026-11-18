import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { normalizeLanguage } from '../index';

export function useLanguage() {
  const { t } = useTranslation();
  const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const setLanguage = useCallback((next) => i18n.changeLanguage(normalizeLanguage(next)), []);
  const toggleLanguage = useCallback(() => setLanguage(language === 'vi' ? 'en' : 'vi'), [language, setLanguage]);
  return { language, t, setLanguage, toggleLanguage };
}
