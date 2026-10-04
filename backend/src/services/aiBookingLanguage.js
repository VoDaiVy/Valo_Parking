const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9']+/g, ' ').trim();

const ENGLISH_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'to', 'from',
  'at', 'on', 'in', 'for', 'until', 'between', 'and', 'or', 'with', 'this', 'next',
  'following', 'tomorrow', 'today', 'morning', 'afternoon', 'evening', 'night', 'want',
  'need', 'like', 'would', 'can', 'could', 'please', 'book', 'reserve', 'parking', 'spot',
  'space', 'car', 'vehicle', 'plate', 'license', 'registration', 'arrive', 'leave', 'start',
  'end', 'change', 'confirm', 'cancel', 'yes', 'no', 'not', 'wrong', 'right', 'hour', 'hours',
  'make', 'it', 'there', 'therefore', 'somewhere', 'bring', 'bringing', 'park', 'save', 'get',
]);

const VIETNAMESE_WORDS = new Set([
  'toi', 'minh', 'ban', 'cho', 'mot', 'hai', 'ba', 'bon', 'nam', 'muon', 'can', 'dat',
  'giu', 'do', 'dau', 'gui', 'xe', 'ngay', 'mai', 'hom', 'kia', 'gio', 'luc', 'tu', 'den',
  'sang', 'chieu', 'toi', 'trua', 'bien', 'so', 'tang', 'khu', 'huy', 'dong', 'y', 'xac',
  'nhan', 'khong', 'dung', 'thoi', 'doi', 'sua', 'them', 'nap', 'vi', 'tien', 'roi', 'nhe',
  'nha', 'duoc', 'vui', 'long', 'giup', 'bay', 'tam', 'chin', 'muoi', 'phut', 'tieng',
]);

const countMatches = (text, patterns) => patterns.reduce(
  (score, pattern) => score + (text.match(pattern)?.length || 0), 0,
);

function detectBookingLanguage(value, previousLanguage = 'vi') {
  const raw = String(value || '').trim();
  const normalized = fold(raw);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { language: previousLanguage === 'en' ? 'en' : 'vi', confidence: 0 };

  let english = tokens.reduce((score, token) => score + (ENGLISH_WORDS.has(token) ? 1 : 0), 0);
  let vietnamese = tokens.reduce((score, token) => score + (VIETNAMESE_WORDS.has(token) ? 1 : 0), 0);

  english += countMatches(normalized, [
    /\b(?:i'd|i'll|i'm|don't|that's|what's|can't|couldn't|wouldn't)\b/g,
    /\b(?:would like|license plate|plate number|parking spot|parking space|day after tomorrow)\b/g,
    /\b(?:go ahead|never mind|make it|looks good|how many)\b/g,
  ]) * 2;
  vietnamese += countMatches(normalized, [
    /\b(?:ngay mai|ngay kia|bien so|dat cho|o do|gio vao|gio ra|dong y)\b/g,
    /\b(?:vui long|bao nhieu|khong muon|cho toi|giup toi)\b/g,
  ]) * 2;
  if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu.test(raw)) {
    vietnamese += 4;
  }

  const evidence = english + vietnamese;
  if (evidence === 0 || Math.abs(english - vietnamese) <= Math.max(1, evidence * 0.15)) {
    return { language: previousLanguage === 'en' ? 'en' : 'vi', confidence: evidence ? 0.55 : 0.35 };
  }
  const language = english > vietnamese ? 'en' : 'vi';
  const confidence = Math.min(0.99, 0.55 + (Math.abs(english - vietnamese) / Math.max(1, evidence)) * 0.44);
  return { language, confidence: Number(confidence.toFixed(2)) };
}

module.exports = { detectBookingLanguage };
