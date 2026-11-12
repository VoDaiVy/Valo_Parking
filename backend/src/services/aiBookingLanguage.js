const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9']+/g, ' ').trim();

const ENGLISH_WORDS = new Set([
  'voucher', 'vouchers', 'discount', 'discounts', 'coupon', 'coupons', 'have', 'any', 'apply', 'code', 'codes',
  'i', 'me', 'my', 'mine', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'to', 'from',
  'at', 'on', 'in', 'for', 'until', 'between', 'and', 'or', 'with', 'this', 'next',
  'following', 'tomorrow', 'today', 'morning', 'afternoon', 'evening', 'night', 'want',
  'need', 'like', 'would', 'can', 'could', 'please', 'book', 'reserve', 'parking', 'spot',
  'space', 'car', 'vehicle', 'plate', 'license', 'registration', 'arrive', 'leave', 'start',
  'end', 'change', 'confirm', 'cancel', 'yes', 'no', 'not', 'wrong', 'right', 'hour', 'hours',
  'make', 'it', 'there', 'therefore', 'somewhere', 'bring', 'bringing', 'park', 'save', 'get',
  'hold', 'keep', 'someplace', 'tonight', 'noon', 'midnight', 'half', 'quarter', 'past',
  'through', 'whole', 'week', 'weekend', 'month', 'days', 'minutes', 'first', 'second',
  'hello', 'hi', 'thanks', 'thank', 'where', 'what', 'how', 'when', 'which', 'show', 'check', 'wallet', 'balance', 'services', 'service', 'fee', 'price', 'slot', 'floor', 'date', 'time', 'amount', 'third', 'other', 'both', 'another', 'exactly', 'sure', 'yep', 'yeah', 'ready', 'proceed',
]);

for (const word of 'bookings cars vehicles do is are hey goodbye bye alright correct'.split(' ')) ENGLISH_WORDS.add(word);

const VIETNAMESE_WORDS = new Set([
  'toi', 'minh', 'ban', 'cho', 'mot', 'hai', 'ba', 'bon', 'nam', 'muon', 'can', 'dat',
  'giu', 'do', 'dau', 'gui', 'xe', 'ngay', 'mai', 'hom', 'kia', 'gio', 'luc', 'tu', 'den',
  'sang', 'chieu', 'toi', 'trua', 'bien', 'so', 'tang', 'khu', 'huy', 'dong', 'y', 'xac',
  'nhan', 'khong', 'dung', 'thoi', 'doi', 'sua', 'them', 'nap', 'vi', 'tien', 'roi', 'nhe',
  'nha', 'duoc', 'vui', 'long', 'giup', 'bay', 'tam', 'chin', 'muoi', 'phut', 'tieng',
  'chao', 'cam', 'on', 'dich', 'vu', 'phi', 'gia', 'tui', 'rang', 'mo', 'lay', 'chon', 'o', 'goi', 'y', 'lien', 'tuc', 'vai', 'tuan', 'thang', 'ca', 'doi',
]);

for (const word of 'da vang co um xin lam on ve em anh chi dang se'.split(' ')) VIETNAMESE_WORDS.add(word);

const weakEnglish = new Set('i me my we our you your the a an to from at on in for and or with this it voucher vouchers booking bookings'.split(' '));

const languageText = (value) => String(value || '').replace(/\b(?:\d{2}[ .-]*[a-z]{1,4}[ .-]*[0-9io]{1,9}|[a-z]{1,3}[ ._-]*\d+(?:[._-]\d+)*)\b/giu, ' ')
  .replace(/[+\-$\u20ac\u20ab]?\s*\d+(?:[.,:/\s-]\d+)*(?:\s*(?:vnd|usd|eur|\u0111\u1ed3ng|\u0111|h\d*|am|pm))?/giu, ' ');

function isLanguageNeutralInput(value) {
  const raw = String(value || '').trim().replace(/^["'([{]+|[.!?,;:"')\]}]+$/g, '').trim();
  if (!raw || /^(?:ok(?:ay)?|oke|uh|um|[a-z])$/i.test(raw)) return true;
  return /\d/.test(raw) && !languageText(raw).replace(/[\s\p{P}\p{S}]/gu, '');
}

function detectBookingLanguage(value, previousLanguage = 'vi') {
  const previous = previousLanguage === 'en' ? 'en' : 'vi';
  const raw = String(value || '').trim();
  if (!raw) return { language: previous, confidence: 0 };
  if (isLanguageNeutralInput(raw)) return { language: previous, confidence: 0.35 };
  const normalized = fold(languageText(raw));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (/^(?:(?:toi|minh|tui|em|anh|chi)\s+(?:muon|can|xin|dang|se)|(?:cho|giup)\s+(?:toi|minh|tui|em)|vui long|lam on|kiem tra|dat (?:xe|cho)|doi (?:gio|ngay|xe)|them (?:xe|dich vu))\b/.test(normalized)) return { language: 'vi', confidence: 0.96 };
  if (/^(?:(?:i|we)\s+(?:(?:would|d)\s+like|want|need|am|are)|i'(?:d|m|ll)\b|(?:can|could|would|will)\s+(?:i|we|you)|please\s+(?:book|reserve|check|show|cancel|confirm|change|tell|help)|(?:check|show|book|reserve|cancel|confirm|change)\s+(?:my|the|a|an|this|these|parking)|(?:where|what|how|when|which))\b/.test(normalized)) return { language: 'en', confidence: 0.96 };
  if (/^(?:da|vang|co|khong|duoc|dong y|bo qua|cam on|xin chao|chao|dung|dung roi|chinh xac|um)$/.test(normalized)) return { language: 'vi', confidence: 0.92 };
  if (/^(?:yes|yes please|no|no thanks|hello|hi|hey|thanks|thank you|goodbye|bye|sure|alright|correct|confirm|cancel|first|second|third|go ahead|looks good)$/.test(normalized)) return { language: 'en', confidence: 0.92 };
  let english = 0; let vietnamese = 0; let vietnameseHits = 0;
  for (const token of tokens) {
    const en = ENGLISH_WORDS.has(token); const vi = VIETNAMESE_WORDS.has(token);
    if (vi) vietnameseHits += 1;
    if (en && vi) continue;
    if (en) english += weakEnglish.has(token) ? 0.2 : 1;
    if (vi) vietnamese += 1;
  }
  english += (normalized.match(/\b(?:would like|license plate|plate number|parking spot|parking space|day after tomorrow|go ahead|never mind|looks good|how many)\b/g)?.length || 0) * 2;
  vietnamese += (normalized.match(/\b(?:ngay mai|ngay kia|bien so|dat cho|o do|gio vao|gio ra|dong y|vui long|bao nhieu|khong muon|cho toi|giup toi|ma giam gia)\b/g)?.length || 0) * 2;
  if (vietnameseHits && /[\u00c0-\u024f\u1e00-\u1eff]/iu.test(raw)) vietnamese += 2;
  const evidence = english + vietnamese; const margin = Math.abs(english - vietnamese);
  if (evidence < 1) return { language: previous, confidence: 0.35 };
  if (english && vietnamese && margin <= Math.max(1, evidence * 0.2)) return { language: previous, confidence: 0.55 };
  return { language: english > vietnamese ? 'en' : 'vi', confidence: Number(Math.min(0.99, 0.65 + margin / evidence * 0.33).toFixed(2)) };
}


// Mixed speech must be verified from audio, not accepted because a domain word matches.
function hasMixedBookingSpeech(value) {
  const text = fold(value);
  const vietnamese = /\b(?:toi|minh|tui|muon|ngay|gio|bien so|dat xe|dat cho|khi nay|khi nao|cho toi|giup|khong|duoc|dich vu)\b/.test(text);
  const english = /\b(?:(?:can|could|may|would) (?:i|we|you)|i (?:want|need)|book|reserve|check my|one car|two cars|from .+ to)\b/.test(text);
  return vietnamese && english;
}

function detectRequestedConversationLanguage(value) {
  const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd');
  if (/^\s*(?:english|vietnamese)(?: please)?[.!]?\s*$/.test(text)) return text.trim().startsWith('english') ? 'en' : 'vi';
  let result = '';
  for (const clause of text.split(/[,;.!?]+/)) {
    const requests = /\b(?:(?:speak|reply|respond|answer|switch|change|use)(?:\s+(?:to me|only|in|to|using|with|entirely))*\s+(english|vietnamese)|(?:noi|tra loi|giao tiep|chuyen|doi|su dung|dung)(?:\s+(?:bang|sang|qua|chi|tieng))*\s+(anh|viet|english|vietnamese))\b/gu;
    for (const match of clause.matchAll(requests)) {
      if (/\b(?:khong|dung|never|not|dont|don't|do not)(?:\s+\w+){0,2}\s*$/.test(clause.slice(0, match.index))) continue;
      result = /^(?:anh|english)$/.test(match[1] || match[2]) ? 'en' : 'vi';
    }
  }
  return result;
}

module.exports = { hasMixedBookingSpeech, detectBookingLanguage, isLanguageNeutralInput, detectRequestedConversationLanguage };
