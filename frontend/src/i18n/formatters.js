import { format as formatDate } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
import i18n from './index';

export const getCurrentLocale = () => (i18n.resolvedLanguage || i18n.language || 'vi').startsWith('en') ? 'en-US' : 'vi-VN';

export const formatCurrency = (value = 0, options = {}) => new Intl.NumberFormat(getCurrentLocale(), {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
  ...options,
}).format(Number(value) || 0);

export const formatNumber = (value = 0, options = {}) => new Intl.NumberFormat(getCurrentLocale(), options).format(Number(value) || 0);

export const formatLocalizedDate = (value, pattern = 'dd/MM/yyyy HH:mm') => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDate(date, pattern, { locale: getCurrentLocale() === 'en-US' ? enUS : vi });
};
