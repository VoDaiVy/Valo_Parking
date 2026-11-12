import { motion } from 'framer-motion';
import { Languages } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export default function LanguageSwitch({ variant = 'dark', size = 'md', className = '' }) {
  const { language, toggleLanguage, t } = useLanguage();
  const compact = size === 'sm';
  const dark = variant === 'dark';
  return (
    <motion.button
      type="button"
      onClick={toggleLanguage}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -1 }}
      aria-label={`${t('common.language')}: ${language === 'vi' ? t('common.vietnamese') : t('common.english')}`}
      title={t('common.language')}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${compact ? 'px-2 py-1 text-[11px]' : ''} ${dark ? 'border-white/15 bg-white/5 text-white hover:border-yellow-300/60 hover:text-yellow-300' : 'border-slate-300 bg-white text-slate-800 hover:border-yellow-500'} ${className}`}
    >
      <Languages size={compact ? 13 : 15} aria-hidden="true" />
      <span>{language.toUpperCase()}</span>
    </motion.button>
  );
}
