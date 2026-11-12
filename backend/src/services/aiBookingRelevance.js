const { isLanguageNeutralInput } = require('./aiBookingLanguage');
// Short answers may supply booking fields, but ordinary sentences must not
// become edits just because they contain a date, floor or zone.
const isUnrelatedBookingMessage = (prompt) => {
  const text = String(prompt || '').toLowerCase()
    .replace(/\bnày\b/giu, ' demonstrative ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/\b(xe\s+(?:thu\s+)?(?:\d+|nhat|mot|hai|ba|tu|bon|nam))\s*:/g, '$1 ')
    .replace(/\b(\d+)\s*:(?!\d)/g, '$1 ')
    .replace(/(?:^|\s)[.:-]+(?=\s|$)/g, ' ')
    .replace(/[^a-z0-9:/.-]+/g, ' ')
    .replace(/\.+(?=\s|$)/g, '').trim();
  if (!text) return true;
  if (isLanguageNeutralInput(prompt)) return false;
  if (/\b(?:them|bo sung)\s+(?:(?:\d+|mot|hai|ba|bon|nam|nhieu|vai)\s+(?:chiec\s+)?)?(?:xe|bien so)\b/.test(text)) return false;
  if (/\b(?:add|include|bring)\s+(?:(?:\d+|one|two|three|four|five|another|more|some|several)\s+)*(?:cars?|vehicles?)\b/.test(text)) return false;
  const bookingAction = /\b(?:dat|giu|giu cho|do|dau|gui)\s+(?:(?:\d+|mot|hai|ba|bon|nam)\s+(?:chiec\s+)?)?(?:cho|xe|o to|oto|o do|ngay|tu|luc)\b|\b(?:book|reserve|park|parking)\b|\b(?:doi|sua|chuyen|thay|them|bo|xoa|chon|lay|cap nhat|huy|kiem tra|xem|tim)\s+(?:(?:sang|qua|lai|giup|cho toi)\s+)?(?:xe|bien|gio|ngay|lich|tang|khu|o|cho|booking|dich vu|goi|vip|voucher)\b/;
  const domainQuery = /\b(?:xe|bien|booking|bai|cho|o do|vi|giao dich|dich vu|goi|vip|voucher|parking|car|vehicle|wallet|service|membership)\b/.test(text)
    && /\b(?:o dau|bao nhieu|khi nao|the nao|con han|het han|co khong|con cho|nao|kiem tra|xem|where|what|how|when|check|show|list|cancel|remove|add|update)\b/.test(text);
  if (bookingAction.test(text) || domainQuery) return false;
  // A malformed plate in an explicitly numbered vehicle list is still
  // booking input. Let the plate parser ask about that row rather than
  // discarding the other valid vehicles as unrelated text.
  const numberedVehicles = /\b(?:xe\s*(?:thu\s*)?|bien(?:\s+so)?\s+thu\s*)(?:\d+|nhat|mot|hai|ba|tu|bon|nam)\b/.test(text);
  const fieldWords = new Set(('toi tui minh ban em anh chi muon can vui long giup nhe nha da vang ok dong y xac nhan dung roi dat chot huy dung thoi khong co thanh va and ' +
    'tu den luc ngay hom nay mai kia mot cuoi tuan thu chu nhat sau nay thang nam sang chieu toi trua dem gio phut tieng ruoi nua nua ' +
    'xe bien so o to oto dien xang tang floor khu zone o do cho vi tri dau gui vao ra bat ket thuc dau tien thu nhat hai ba bon tu nam sau bay tam chin muoi ' +
    'doi sua chuyen thay sang qua them bot bo xoa chon lay khac lai goi y de xuat lien tuc qua dem trong sau dau ' +
    'the first second third fourth fifth one two three four five today tomorrow next this week weekend monday tuesday wednesday thursday friday saturday sunday ' +
    'at from to until am pm morning afternoon evening night hour hours minute minutes for in start end arrival departure time date plate license number car vehicle slot floor zone change instead use select choose yes no confirm cancel please').split(/\s+/));
  return text.split(/\s+/).some((token) => !fieldWords.has(token)
    && !(numberedVehicles && /^\d{2}[a-z][a-z0-9.-]{0,14}$/.test(token))
    && !/^\d+(?:[/:.\-]\d+)*(?:h\d*|am|pm)?$/.test(token)
    && !/^\d{2}[a-z]{1,2}(?:-?\d{0,5}|-?\d{3}\.\d{2})$/.test(token)
    && !/^[a-z]{1,3}[-_.]?\d+(?:[-_.]\d+)?$/.test(token));
};

module.exports = { isUnrelatedBookingMessage };
