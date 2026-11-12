import vietnamese from './vi.json';

export type TranslationParams = Record<string, string | number>;

// Translate application copy only. Callers keep server content and user data intact.
export function translateMessage(language: 'en' | 'vi', message: string, params?: TranslationParams) {
  const key = message.trim().replace(/\s+/g, ' ');
  const dictionary: Record<string, string> = vietnamese;
  const result = language === 'vi' && Object.prototype.hasOwnProperty.call(dictionary, key)
    ? dictionary[key]
    : message;
  return params ? result.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token) : result;
}
