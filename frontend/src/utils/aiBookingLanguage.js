const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd')
  .replace(/[^a-z0-9']+/g, ' ').trim();

const ENGLISH_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'to', 'from',
  'at', 'on', 'in', 'for', 'until', 'and', 'or', 'with', 'this', 'next', 'tomorrow',
  'today', 'morning', 'afternoon', 'evening', 'night', 'want', 'need', 'please',
  'book', 'reserve', 'parking', 'spot', 'space', 'car', 'vehicle', 'plate', 'license',
  'arrive', 'leave', 'start', 'end', 'change', 'confirm', 'cancel', 'hour', 'hours',
  'minutes', 'now', 'where', 'when', 'what', 'which', 'show', 'check',
]);

const VIETNAMESE_WORDS = new Set([
  'toi', 'minh', 'ban', 'cho', 'mot', 'hai', 'ba', 'bon', 'nam', 'muon', 'can',
  'dat', 'giu', 'do', 'dau', 'gui', 'xe', 'ngay', 'mai', 'hom', 'kia', 'gio',
  'luc', 'tu', 'den', 'sang', 'chieu', 'trua', 'bien', 'so', 'tang', 'khu',
  'huy', 'dong', 'xac', 'nhan', 'khong', 'dung', 'thoi', 'doi', 'sua', 'them',
  'nap', 'vi', 'tien', 'roi', 'nhe', 'nha', 'duoc', 'vui', 'long', 'giup', 'phut',
  'tieng', 'lay', 'chon', 'goi', 'lien', 'tuc', 'tuan', 'thang',
]);

const score = (tokens, words) => tokens.reduce(
  (total, token) => total + (words.has(token) ? 1 : 0), 0,
);

export function detectRequestedConversationLanguage(value) {
  const text = fold(value);
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!text || tokens.length > 12) return '';
  const hasSwitchCue = /\b(?:doi|chuyen|dung|noi|switch|change|use|speak|conversation|chat|tro chuyen)\b/.test(text);
  if (!hasSwitchCue) return '';
  if (/\b(?:tieng anh|english)\b/.test(text)) return 'en';
  if (/\b(?:tieng viet|vietnamese)\b/.test(text)) return 'vi';
  return '';
}

export function detectBookingInputLanguage(value, fallbackLanguage = 'vi') {
  const raw = String(value || '').trim();
  const tokens = fold(raw).split(/\s+/).filter(Boolean);
  const fallback = fallbackLanguage === 'en' ? 'en' : 'vi';
  if (!tokens.length) return { language: fallback, confidence: 0 };

  let english = score(tokens, ENGLISH_WORDS);
  let vietnamese = score(tokens, VIETNAMESE_WORDS);
  if (/[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u00e1\u00e0\u1ea3\u00e3\u1ea1\u1ea5-\u1ef9]/iu.test(raw)) {
    vietnamese += 4;
  }
  const evidence = english + vietnamese;
  if (!evidence || (english > 0 && vietnamese > 0 && Math.abs(english - vietnamese) <= 1)) {
    return { language: fallback, confidence: evidence ? 0.55 : 0.35 };
  }
  const language = english > vietnamese ? 'en' : 'vi';
  const confidence = Math.min(0.99, 0.55 + (Math.abs(english - vietnamese) / evidence) * 0.44);
  return { language, confidence: Number(confidence.toFixed(2)) };
}

export function detectSelectedLanguageMismatch(value, selectedLanguage) {
  const selected = selectedLanguage === 'en' ? 'en' : 'vi';
  const detected = detectBookingInputLanguage(value, selected);
  return detected.language !== selected && detected.confidence >= 0.8 ? detected : null;
}
