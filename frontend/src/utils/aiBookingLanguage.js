const fold = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9']+/g, ' ').trim();

const english = new Set([
  'i', 'my', 'we', 'you', 'the', 'a', 'an', 'to', 'from', 'at', 'on', 'for', 'until',
  'tomorrow', 'today', 'next', 'morning', 'afternoon', 'evening', 'want', 'need', 'please',
  'book', 'reserve', 'parking', 'spot', 'space', 'car', 'vehicle', 'plate', 'license',
  'arrive', 'leave', 'change', 'confirm', 'cancel', 'yes', 'no', 'top', 'up', 'show', 'qr',
]);
const vietnamese = new Set([
  'toi', 'minh', 'ban', 'cho', 'muon', 'can', 'dat', 'giu', 'do', 'xe', 'ngay', 'mai',
  'hom', 'gio', 'luc', 'tu', 'den', 'sang', 'chieu', 'bien', 'so', 'tang', 'khu', 'huy',
  'dong', 'y', 'xac', 'nhan', 'khong', 'doi', 'sua', 'them', 'nap', 'vi', 'tien',
]);

export function detectAiBookingLanguage(value, previousLanguage = 'vi') {
  const raw = String(value || '');
  const tokens = fold(raw).split(/\s+/).filter(Boolean);
  let en = tokens.filter((word) => english.has(word)).length;
  let vi = tokens.filter((word) => vietnamese.has(word)).length;
  if (/\b(?:license plate|parking spot|parking space|go ahead|never mind|would like)\b/i.test(raw)) en += 2;
  if (/\b(?:biển số|ngày mai|đặt chỗ|nạp thêm|đồng ý)\b/i.test(raw)) vi += 2;
  if (/[ăâđêôơưáàảãạếềốồớờứừ]/iu.test(raw)) vi += 4;
  if (en === vi || (!en && !vi)) return previousLanguage === 'en' ? 'en' : 'vi';
  return en > vi ? 'en' : 'vi';
}
