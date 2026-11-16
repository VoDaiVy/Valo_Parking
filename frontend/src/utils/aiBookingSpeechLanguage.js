import { detectBookingInputLanguage, isLanguageNeutralInput, hasMixedBookingSpeech } from './aiBookingLanguage.js';

// A UI locale is not evidence of the language in microphone audio. The fast
// recognizer is used only after an accepted multilingual audio transcription.
export function canUseFastBookingSpeech(text, verifiedSpeechLanguage) {
  if (!['vi', 'en'].includes(verifiedSpeechLanguage)) return false;
  const raw = String(text || '').trim().replace(/[.!?,;]+$/u, '').trim();
  if (!raw) return false;
  if (hasMixedBookingSpeech(raw)) return false;
  if (isLanguageNeutralInput(raw)) return true;
  const detected = detectBookingInputLanguage(raw, verifiedSpeechLanguage);
  if (detected.language !== verifiedSpeechLanguage || detected.confidence < 0.65) return false;
  const value = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  return /\b(?:book|booking|reserve|parking|car|cars|vehicle|vehicles|plate|slot|floor|wallet|balance|fee|price|service|voucher|discount|coupon|cancel|confirm|dat|xe|bai|bien|tang|vi|phi|gia|dich vu|goi|huy|xac nhan|dung ma|ap dung ma)\b/u.test(value)
    || /^(?:yes|yes please|no|no thanks|go ahead|that one|first|second|co|khong|dong y|duoc|bo qua|xe thu (?:nhat|hai|ba)|\d{1,2} gio(?: den \d{1,2} gio)?)$/u.test(value);
}
