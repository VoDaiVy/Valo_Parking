const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const Policy = require('../models/Policy');
const RefundRuleVersion = require('../models/RefundRuleVersion');
const Service = require('../models/Service');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const UserVoucher = require('../models/UserVoucher');
const Vehicle = require('../models/Vehicle');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const pricingEngine = require('./pricingEngine');
const { extractLicensePlates, parseBookingUtterance } = require('./bookingUtteranceParser');
const { isValidCarLicensePlate, normalizeLicensePlate } = require('../utils/licensePlateUtils');

const QUERY_INTENTS = new Set([
  'CHECK_VEHICLE_PARKING_STATUS', 'CHECK_VEHICLE_ENTRY_TIME',
  'CHECK_VEHICLE_EXIT_TIME', 'CHECK_VEHICLE_LOCATION',
  'CHECK_VEHICLE_DURATION', 'CHECK_PARKING_FEE', 'CHECK_BOOKING_STATUS',
  'CHECK_UPCOMING_BOOKING', 'CHECK_PARKING_AVAILABILITY', 'CHECK_SLOT_STATUS', 'CHECK_WALLET_BALANCE',
  'CHECK_PAYMENT_STATUS', 'CHECK_TRANSACTION_HISTORY', 'LIST_MY_VEHICLES',
  'CHECK_SERVICES', 'BOOK_SERVICE', 'CHECK_VOUCHERS', 'USE_VOUCHER',
  'CHECK_PARKING_POLICY', 'CHECK_TICKET_PACKAGES', 'HELP',
  'ADD_VEHICLE', 'UPDATE_VEHICLE', 'REMOVE_VEHICLE',
]);

const fold = (value = '') => String(value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const compactPlate = (value) => normalizeLicensePlate(String(value || ''));
const formatDate = (value, options) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', ...options }).format(date);
};
const vnDateTime = (value) => formatDate(value, {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const vnTime = (value) => formatDate(value, {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đồng`;
const idOf = (value) => String(value?._id || value || '');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matches = (text, patterns) => patterns.some((pattern) => pattern.test(text));

function detectIntents(text) {
  const intents = [];
  const add = (intent, patterns) => { if (matches(text, patterns)) intents.push(intent); };

  add('HELP', [
    /\b(tro giup|giup toi|lam duoc gi|huong dan|chuc nang|ho tro gi|ban biet lam gi|hoi gi duoc)\b/,
    /\b(help|what can you do|how can you help|show me what you can do|what can i ask)\b/,
  ]);
  add('ADD_VEHICLE', [/\b(them|dang ky|tao)\s+(xe|phuong tien|bien so)\b/, /\b(add|register)\s+(a\s+|my\s+)?(vehicle|car|license plate)\b/]);
  add('REMOVE_VEHICLE', [/\b(xoa|go|bo)\s+(xe|phuong tien|bien so)\b/, /\b(remove|delete)\s+(a\s+|my\s+)?(vehicle|car|license plate)\b/]);
  add('UPDATE_VEHICLE', [/\b(sua|cap nhat|doi)\s+(thong tin\s+)?(xe|bien so|ten xe|mau xe)\b/, /\b(update|edit|change)\s+(my\s+)?(vehicle|car|license plate|vehicle name|car color)\b/]);
  add('LIST_MY_VEHICLES', [
    /\b(danh sach|liet ke|xem)\s+(cac\s+)?xe\b/,
    /\b(toi|minh)\s+(co|da dang ky)\s+(nhung |cac )?xe\b/,
    /\bxe nao\s+(trong|thuoc)\s+tai khoan\b/,
    /\b(co bao nhieu xe|nhung bien so nao|bien so nao.*da dang ky|xe da dang ky)\b/,
    /\b(show|list|view)\s+(all\s+)?(my\s+)?(vehicles|cars)\b/,
    /\b(what|which)\s+(vehicles|cars)\s+(are\s+)?(in|on|registered to)\s+my\s+account\b/,
  ]);
  add('CHECK_WALLET_BALANCE', [
    /\b(so du|vi (con|co)|con bao nhieu tien|tien trong vi)\b/,
    /\b(kiem tra|xem).*(vi|so du)\b/,
    /\bvi.*(bao nhieu|du tien|het tien)\b/,
    /\b(wallet balance|balance in my wallet|how much.*(?:in|left in).*wallet)\b/,
  ]);
  add('CHECK_TRANSACTION_HISTORY', [
    /\b(lich su giao dich|giao dich gan day|cac giao dich|xem giao dich)\b/,
    /\b(nap tien|tru tien|bien dong so du).*(gan nhat|luc nao|khi nao|lich su)\b/,
    /\b(xem|cho xem|kiem tra)?\s*(bien dong so du|lich su nap tien|lich su tru tien)\b/,
    /\b(transaction history|recent transactions|wallet transactions|payment history)\b/,
  ]);
  add('CHECK_PAYMENT_STATUS', [
    /\b(da thanh toan|thanh toan chua|chua thanh toan|trang thai thanh toan|tra tien chua)\b/,
    /\b(booking|dat cho|don).*(da tra tien|con no|can thanh toan)\b/,
    /\b(payment status|paid yet|has .*booking.*been paid|unpaid booking)\b/,
  ]);
  add('CHECK_SERVICES', [
    /\b(co dich vu gi|danh sach dich vu|xem dich vu|dich vu nao|cac dich vu)\b/,
    /\b(co|ho tro)\s+(rua xe|sac xe|cham soc xe)\s+(khong|chua)\b/,
    /\b(rua xe|sac xe|cham soc xe).*(co khong|gia bao nhieu)\b/,
    /\b(available services|what services|list services|show services|service prices?)\b/,
  ]);
  add('BOOK_SERVICE', [
    /\b(dat|them|chon|dung|lay|bo|xoa|huy|book|add|select|remove|delete|cancel)\s+(dich vu|service|rua xe|sac xe|cham soc xe)\b/,
    /\b(muon|can)\s+(rua xe|sac xe|cham soc xe)\b/,
    /\b(car\s*wash|water\s*spot|coating|polishing|scratch|deep\s*cleaning|ozone|rua\s*xe|hut\s*bui|tay\s*o|danh\s*bong)\b/,
  ]);
  add('CHECK_VOUCHERS', [
    /\b(xem|kiem tra|danh sach|co|con)\s+(voucher|ma giam gia|uu dai)\b/,
    /\b(voucher|ma giam gia)\s+(nao|gi|kha dung|con han|cua toi)\b/,
    /\b(show|list|check|view)\s+(my\s+)?(available\s+)?(vouchers?|discounts?)\b/,
  ]);
  add('USE_VOUCHER', [
    /\b(dung|ap dung|chon|them|bo|xoa|huy)\s+(voucher|ma giam gia|uu dai)\b/,
    /\b(use|apply|select|add|remove|clear)\s+(a\s+|my\s+|the\s+)?(voucher|discount)\b/,
  ]);
  add('CHECK_PARKING_POLICY', [
    /\b(chinh sach|quy dinh|noi quy|dieu khoan|hoan tien)\b/,
    /\b(huy booking|huy dat cho).*(mat phi|duoc hoan|hoan bao nhieu)\b/,
    /\b(duoc do|duoc gui).*(toi da|bao lau)\b/,
    /\b(parking policy|parking rules|terms and conditions|cancellation policy|refund policy|maximum parking time)\b/,
  ]);
  add('CHECK_TICKET_PACKAGES', [
    /\b(xem\s+)?(goi\s+vip|goi\s+thang|goi\s+nam|goi\s+ve|ve\s+thang|ve\s+nam|dang\s+ky\s+vip|mua\s+vip|cac\s+goi|bang\s+gia\s+goi)\b/,
    /\b(vip|membership)\b.*\b(gia|co\s+nhung\s+gi|quyen\s+loi|bao\s+nhieu|nhu\s+the\s+nao|dang\s+ky|mua)\b/,
    /\b(co|ban)\s+(ve\s+thang|goi\s+thang|goi\s+vip)\s*(khong|chua)?\b/,
    /\b(show|view|list|see)\s+(the\s+|all\s+|available\s+)?(vip\s+|parking\s+|monthly\s+)?packages?\b/,
    /\b(vip packages?|membership|monthly (pass|package)|annual (pass|package)|yearly (pass|package)|subscription plans?|parking packages?)\b/,
  ]);
  add('CHECK_UPCOMING_BOOKING', [
    /\b(booking|dat cho).*(sap toi|hom nay|ke tiep)\b/,
    /\b(sap toi|hom nay).*(booking|dat cho)\b/,
    /\b(lich dat|lich do).*(sap toi|hom nay|gan nhat|ke tiep)\b/,
    /\b(hom nay|ngay mai).*(co lich|co booking|da dat cho)\b/,
    /\b(upcoming|next|today'?s?)\s+(booking|reservation)\b/,
    /\b(show|check|view)\s+(my\s+)?(upcoming|next)\s+(booking|reservation)\b/,
  ]);
  add('CHECK_BOOKING_STATUS', [
    /\b(trang thai|kiem tra|xem).*(booking|dat cho)\b/,
    /\bbooking cua (toi|minh)\b/,
    /\b(da|co)\s+(dat|dat cho|booking)\s+chua\b/,
    /\bxe.*(da|co)\s+(dat|dat cho|booking)\s+chua\b/,
    /\b(da|co)\s+(dat( cho)?|booking)\b(?:\s+[a-z0-9]+){0,6}\s+(chua|khong)\b/,
    /\b(dat( cho)?|booking)\s+(ngay nao|luc nao|khi nao)\b/,
    /\b(ngay nao|luc nao|khi nao)\s+(da\s+)?(dat( cho)?|booking)\b/,
    /\b(co|da co)\s+(lich dat|lich do|booking)\s+(chua|khong)\b/,
    /\b(booking|lich dat)\s+(gan nhat|moi nhat)\b/,
    /\b(booking|reservation)\s+status\b/,
    /\b(show|check|view)\s+(my\s+)?(booking|reservation)s?\b/,
    /\b(da\s+)?co\s+(bai do|cho do|o do|cho dat|lich dat|lich do)\s+(chua|khong)\b/,
    /\b(da\s+)?duoc\s+(xep|gan|cap)\s+(bai|cho|o)(\s+do)?\s+(chua|khong)\b/,
    /\b(da\s+)?co\s+(bai do|cho do|o do|cho dat|lich dat|lich do)\b(?:\s+[a-z0-9]+){0,6}\s+(chua|khong)\b/,
    /\b(da\s+)?duoc\s+(xep|gan|cap)\s+(bai|cho|o)(\s+do)?\b(?:\s+[a-z0-9]+){0,6}\s+(chua|khong)\b/,
  ]);
  add('CHECK_SLOT_STATUS', [
    /\b(o|slot)\s*[a-z]{0,3}[-_. ]?\d+.*\b(trong|ban|co xe|tinh trang)\b/,
    /\b(trang thai|kiem tra).*(o|slot)\s*[a-z]{0,3}[-_. ]?\d+\b/,
    /\b(o|slot)\s*[a-z]{0,3}[-_. ]?\d+.*\b(co ai do|dang dung|dau xe|do xe)\b/,
    /\b(o|slot)\s*[a-z]{0,3}[-_. ]?\d+.*\b(dang duoc dung|dang bi chiem|co nguoi dung)\b/,
    /\b(is\s+)?slot\s*[a-z]{0,3}[-_. ]?\d+.*\b(available|free|occupied|taken|status)\b/,
  ]);
  add('CHECK_PARKING_AVAILABILITY', [
    /\bcon\s+(bao nhieu\s+)?(cho|o)(\s+nao)?(\s+trong)?\b/,
    /\bco\s+(cho|o)\s+trong\s+(khong|chua)\b/,
    /\b(cho|o)\s+nao\s+trong\b/,
    /\bkiem tra.*(cho trong|o trong)\b/,
    /\bcon\s+(cho|o)\b/,
    /\b(tang|zone|khu).*(con|co).*(cho|o)\b/,
    /\b(bai|nha xe|ham).*(day|het cho|con trong|con cho)\b/,
    /\b(co the|vao).*(do xe|dau xe).*(khong|chua)\b/,
    /\b(any|how many)\s+(parking\s+)?(spaces?|slots?)\s+(available|free|left)\b/,
    /\b(is\s+there|are\s+there)\s+(a|any)?\s*(parking\s+)?(space|slot)s?\s+(available|free)\b/,
    /\b(is\s+)?(the\s+)?(parking lot|car park|garage)\s+(full|available)\b/,
  ]);
  add('CHECK_VEHICLE_ENTRY_TIME', [
    /\b(vao luc may|vao bai luc may|gio vao|vao bai luc|check.?in luc)\b/,
    /\b(vao bai|den bai|gui xe).*(luc nao|khi nao|may gio)\b/,
    /\b(luc nao|khi nao|may gio).*(vao bai|check.?in)\b/,
    /\b(when|what time).*(enter|entered|check.?in|arrive)/,
  ]);
  add('CHECK_VEHICLE_EXIT_TIME', [
    /\b(ra luc may|ra bai luc may|gio ra|da ra (bai )?chua|xe.*ra chua|check.?out luc)\b/,
    /\b(ra bai|roi bai|lay xe).*(luc nao|khi nao|may gio|chua)\b/,
    /\bxe.*da ra ngoai\s+(chua|khong)\b/,
    /\b(when|what time).*(exit|exited|check.?out|leave|left)/,
  ]);
  add('CHECK_VEHICLE_LOCATION', [
    /\b(dang o dau|do o dau|xe.*o dau|vi tri (xe|do)|nam o dau|o tang nao|o o nao)\b/,
    /\bxe.*(tang may|tang nao|o nao|khu nao|zone nao)\b/,
    /\b(tim|kiem tra).*vi tri.*xe\b/,
    /\b(where is|find|locate)\s+(my\s+)?(vehicle|car)\b/,
  ]);
  add('CHECK_VEHICLE_DURATION', [
    /\b(da do bao lau|o bai bao lau|thoi gian do|do duoc bao lau)\b/,
    /\b(da gui|gui xe|vao bai).*(bao lau|may phut|may tieng)\b/,
    /\bbao lau.*(trong bai|do xe|gui xe)\b/,
    /\b(o|nam)\s+(o\s+)?trong bai\s+bao lau\b/,
    /\bhow long.*(vehicle|car).*(parked|in the (parking lot|garage))\b/,
  ]);
  add('CHECK_PARKING_FEE', [
    /\b(phi|tien do|chi phi).*(bao nhieu|tam tinh|hien tai)?\b/,
    /\bbao nhieu tien\b/,
    /\b(tam tinh|hien tai|toi gio).*(het|mat|la)\s+bao nhieu\b/,
    /\bxe.*(het|mat)\s+bao nhieu\s+tien\b/,
    /\b(current|estimated|parking)\s+(parking\s+)?(fee|cost|charge)\b/,
    /\bhow much.*(parking|parked|my car|my vehicle)\b/,
  ]);
  add('CHECK_VEHICLE_PARKING_STATUS', [
    /\b(da vao bai chua|co trong bai|dang trong bai|xe dang do|trang thai xe)\b/,
    /\b(co|da)\s+(do|dau)\s+(xe\s+)?chua\b/,
    /\bxe.*(co|da)\s+(do|dau)\s+chua\b/,
    /\bxe.*dang do\b/,
    /\bxe.*(con|co|dang)\s+(o|trong)\s+bai\s+(khong|chua)\b/,
    /\bxe.*(con|co|dang|co dang)\s+o\s+trong\s+bai\s+(khong|chua)\b/,
    /\bxe.*(da vao|vao)\s+bai\s+(chua|khong)\b/,
    /\b(is|has)\s+(my\s+)?(vehicle|car).*(in|entered)\s+(the\s+)?(parking lot|garage|car park)\b/,
    /\b(vehicle|car)\s+parking\s+status\b/,
  ]);

  let unique = [...new Set(intents)];
  // "Giúp tôi đặt..." là lệnh đặt chỗ/dịch vụ, không phải câu hỏi về chức năng trợ lý.
  if (unique.includes('HELP')
    && /\b(giup toi|ho tro toi)?\s*(muon|can)?\s*dat\s+(cho|bai do|o do|xe|dich vu|rua xe|sac xe)\b/.test(text)) {
    unique = unique.filter((intent) => intent !== 'HELP');
  }
  // Câu hỏi giá dịch vụ như "rửa xe giá bao nhiêu" không phải phí gửi xe.
  if (unique.includes('CHECK_SERVICES') && /\b(rua xe|sac xe|cham soc xe|dich vu)\b/.test(text)) {
    unique = unique.filter((intent) => intent !== 'CHECK_PARKING_FEE');
  }
  if (unique.includes('CHECK_TRANSACTION_HISTORY')
    && /\b(giao dich|bien dong|nap tien|tru tien)\b/.test(text)) {
    unique = unique.filter((intent) => intent !== 'CHECK_WALLET_BALANCE');
  }
  if (unique.includes('CHECK_VEHICLE_PARKING_STATUS')
    && /\bxe\b.*\b(o|trong|vao)\s+(trong\s+)?bai\b/.test(text)) {
    unique = unique.filter((intent) => intent !== 'CHECK_PARKING_AVAILABILITY');
  }
  if (unique.includes('CHECK_BOOKING_STATUS')
    && /\b(da co|duoc xep|duoc gan|duoc cap).*(bai do|cho do|o do|cho dat)\b/.test(text)) {
    unique = unique.filter((intent) => intent !== 'CHECK_PARKING_AVAILABILITY' && intent !== 'CHECK_SLOT_STATUS');
  }
  return unique;
}

function extractSlot(text) {
  const match = text.match(/(?:ô|o)(?:\s+(?:đỗ|do))?\s*(?:số|so|mã|ma)?\s*([a-z]{1,3}[-_. ]?\d{1,5})\b/i)
    || text.match(/\bslot\s*(?:so|ma)?\s*([a-z]{1,3}[-_. ]?\d{1,5})\b/i);
  return match ? match[1].replace(/[_. ]/g, '-').toUpperCase() : '';
}

function extractVehicleChanges(prompt, normalized) {
  const changes = {};
  const type = normalized.match(/\b(xe dien|o to dien|dien)\b/) ? 'electric_car'
    : (normalized.match(/\b(o to|xe hoi|xe thuong)\b/) ? 'car' : '');
  if (type) changes.vehicleType = type;
  const brand = String(prompt).match(/\b(?:hãng|hang|hiệu|hieu)\s+([\p{L}\d][\p{L}\d .-]{0,40})/iu);
  if (brand) changes.brand = brand[1].trim();
  const nickname = String(prompt).match(/\b(?:tên|ten|biệt danh|biet danh)\s+(?:xe\s+)?(?:là|la|thành|thanh)?\s*["“]?([^"”.,]{1,50})/iu);
  if (nickname) changes.nickname = nickname[1].trim();
  const renamed = /\b(doi|sua)\s+(ten|biet danh)\b/.test(normalized)
    ? String(prompt).match(/(?:thành|thanh|là|la)\s+["“]?([^"”.,]{1,50})/iu)
    : null;
  if (renamed) changes.nickname = renamed[1].trim();
  const color = String(prompt).match(/\b(?:màu|mau)\s+([\p{L}]{2,20})/iu);
  if (color) changes.color = color[1].trim();
  return changes;
}

function parseAssistantRequest({ prompt, draft = {}, today, currentTime = '' }) {
  const raw = String(prompt || '').trim();
  const text = fold(raw);
  if (!raw) return null;
  let intents = detectIntents(text);
  const hasActiveBookingDraft = draft.__intent === 'CREATE_BOOKING'
    && (Number(draft.requestedVehicleCount || 0) > 0
      || Boolean(draft.startDate || draft.endDate || draft.startTime || draft.endTime)
      || (Array.isArray(draft.reservationItems) && draft.reservationItems.length > 0));
  if (!intents.length && hasActiveBookingDraft
    && /^(?:them|chon|bo|xoa|huy|add|select|remove|delete|cancel)\s+(?!(?:xe|bien|ngay|gio|tang|o\b|slot\b|booking\b|dat cho\b)).+/i.test(text)) {
    // Service names are administrator-defined. Resolve the name against the
    // database in handleServices instead of maintaining a hard-coded list.
    intents = ['BOOK_SERVICE'];
  }
  const context = draft.assistantContext && typeof draft.assistantContext === 'object'
    ? draft.assistantContext : {};
  const pendingType = context.pendingAction?.type;
  if (!intents.length && ['ADD_VEHICLE', 'UPDATE_VEHICLE', 'REMOVE_VEHICLE'].includes(pendingType)) {
    intents = [pendingType];
  }
  if (!intents.length) return null;

  const bookingInterpretation = parseBookingUtterance(raw, today, draft, currentTime);
  const bookingEntities = bookingInterpretation?.changes || {};
  const vehicleChanges = extractVehicleChanges(raw, text);
  const editsBookingItem = Array.isArray(bookingEntities.reservationItems)
    || bookingInterpretation?.pendingReservationEditField !== undefined
    || bookingInterpretation?.pendingReservationEditIndex !== undefined;
  const explicitlyEditsVehicleProfile = Object.keys(vehicleChanges).length > 0;

  // "Đổi xe 44B11122 thành từ 8 giờ đến 9 giờ" is an edit to the
  // in-progress booking, not a request to mutate the registered vehicle.
  // Let the booking interpreter handle it so the named reservation item is
  // retained and only its schedule/slot is changed.
  if (hasActiveBookingDraft && editsBookingItem && !explicitlyEditsVehicleProfile) {
    intents = intents.filter((intent) => intent !== 'UPDATE_VEHICLE');
    if (!intents.length) return null;
  }
  if (hasActiveBookingDraft && bookingInterpretation
    && (bookingEntities.licensePlate || bookingEntities.requestedVehicleCount)) {
    intents = intents.filter((intent) => !['ADD_VEHICLE', 'REMOVE_VEHICLE'].includes(intent));
    if (!intents.length) return null;
  }

  const directPlates = [...new Set([
    ...(Array.isArray(bookingEntities.licensePlates) ? bookingEntities.licensePlates : []),
    ...extractLicensePlates(text),
  ])];
  const licensePlate = compactPlate(bookingEntities.licensePlate || directPlates[0] || context.licensePlate);
  const zone = raw.match(/\b(?:zone|khu)\s*([a-z0-9-]{1,12})\b/i)?.[1]?.toUpperCase() || '';
  const floorName = bookingEntities.floorName || raw.match(/\b(?:tầng|tang|floor)\s*([a-z0-9-]{1,12})\b/i)?.[1] || '';
  const serviceName = raw.match(/\b(?:dịch vụ|dich vu|service)\s+([^,.;:?]{2,80})/i)?.[1]?.trim()
    || raw.match(/\b(?:thêm|them|chọn|chon|bỏ|bo|xóa|xoa|hủy|huy|add|select|remove|delete|cancel)\s+(?!(?:xe|biển|bien|ngày|ngay|giờ|gio|tầng|tang|ô|o|slot|booking|đặt chỗ|dat cho)\b)([^,.;:?]{2,80})/iu)?.[1]?.trim()
    || (text.includes('water spot') || text.includes('coating') ? 'glass water spot removal & coating'
      : (text.includes('car wash') || text.includes('rua xe') || text.includes('vacuuming')) ? 'car wash & interior vacuuming'
      : (text.includes('polishing') || text.includes('scratch') || text.includes('danh bong')) ? 'paint polishing & scratch removal'
      : (text.includes('deep cleaning') || text.includes('ozone') || text.includes('noi that')) ? 'interior deep cleaning & ozone odor removal'
      : (text.includes('sac xe') || text.includes('charging')) ? 'sạc xe điện' : '');
  const entities = {
    licensePlate: isValidCarLicensePlate(licensePlate) ? licensePlate : '',
    licensePlates: directPlates.map(compactPlate).filter(isValidCarLicensePlate),
    floorName: String(floorName || context.floorName || '').trim(),
    zoneName: zone || context.zoneName || '',
    slotCode: extractSlot(raw) || context.slotCode || '',
    startDate: bookingEntities.startDate || '', endDate: bookingEntities.endDate || '',
    startTime: bookingEntities.startTime || '', endTime: bookingEntities.endTime || '',
    vehicleType: bookingEntities.vehicleType || draft.vehicleType || '',
    requestedVehicleCount: bookingEntities.requestedVehicleCount || draft.requestedVehicleCount || 0,
    serviceName,
    vehicleChanges,
    bookingId: context.bookingId || '', sessionId: context.sessionId || '',
    pendingAction: context.pendingAction || null,
  };
  if (pendingType === 'UPDATE_VEHICLE' && context.pendingAction?.licensePlate) {
    const targetPlate = compactPlate(context.pendingAction.licensePlate);
    const spokenNewPlate = directPlates.map(compactPlate).find((plate) => plate !== targetPlate);
    entities.licensePlate = targetPlate;
    if (spokenNewPlate) entities.vehicleChanges.licensePlate = spokenNewPlate;
  } else if (intents.includes('UPDATE_VEHICLE') && directPlates.length > 1) {
    entities.licensePlate = compactPlate(directPlates[0]);
    entities.vehicleChanges.licensePlate = compactPlate(directPlates[1]);
  }
  if (pendingType === 'ADD_VEHICLE' && context.pendingAction && !context.pendingAction.brand
    && !entities.vehicleChanges.brand && !entities.licensePlate
    && !entities.vehicleChanges.vehicleType && raw.length <= 50) {
    entities.vehicleChanges.brand = raw.replace(/[.,?!]+$/g, '').trim();
  }
  return { intent: intents[0], intents, entities, rawText: raw, draft };
}

async function ownedData(userId) {
  const vehicles = await Vehicle.find({ owner: userId })
    .sort({ isDefault: -1, createdAt: -1 }).lean();
  const approvedPlates = vehicles
    .filter((item) => item.status === 'approved')
    .map((item) => compactPlate(item.licensePlate))
    .filter(Boolean);
  const ownership = [{ userId }];
  if (approvedPlates.length) ownership.push({ licensePlate: { $in: approvedPlates } });
  const bookings = await Booking.find({ $or: ownership })
    .sort({ scheduledStart: -1 }).lean();
  return { vehicles, bookings };
}

function accessiblePlates(data) {
  return [...new Set([
    ...data.vehicles.filter((item) => item.status === 'approved').map((item) => compactPlate(item.licensePlate)),
    ...data.bookings.map((item) => compactPlate(item.licensePlate)),
  ].filter(Boolean))];
}

function resolvePlate(requested, data) {
  const plates = accessiblePlates(data);
  if (requested) return plates.includes(compactPlate(requested)) ? compactPlate(requested) : null;
  if (plates.length === 1) return plates[0];
  return '';
}

function choosePlateMessage(data) {
  const plates = accessiblePlates(data);
  if (!plates.length) return 'Tài khoản chưa có xe hoặc booking nào để kiểm tra.';
  return `Bạn muốn kiểm tra xe nào? ${plates.join(', ')}.`;
}

async function findOwnedSession(userId, plate, data, activeOnly = false) {
  const bookingIds = data.bookings.map((item) => item._id);
  const scope = [
    { userId },
    ...(bookingIds.length ? [{ bookingId: { $in: bookingIds } }] : []),
    ...(plate ? [{ userId: null, bookingId: null, licensePlate: plate }] : []),
  ];
  const query = { $or: scope };
  if (plate) query.licensePlate = plate;
  if (activeOnly) query.status = 'active';
  return Session.findOne(query).sort({ checkInTime: -1 })
    .populate('floorId', 'name floorNumber').lean();
}

function sessionContext(session, plate) {
  return {
    licensePlate: plate || compactPlate(session?.licensePlate),
    sessionId: idOf(session?._id),
    floorName: session?.floorId?.name || '', slotCode: session?.parkingSlot || '',
    bookingId: idOf(session?.bookingId),
  };
}

function durationText(start, end) {
  const minutes = Math.max(0, Math.floor((new Date(end) - new Date(start)) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} giờ` : '', rest ? `${rest} phút` : ''].filter(Boolean).join(' ') || 'chưa đủ 1 phút';
}

async function handleVehicleSessionIntent(intent, parsed, userId, now) {
  const data = await ownedData(userId);
  const plate = resolvePlate(parsed.entities.licensePlate, data);
  if (parsed.entities.licensePlate && !plate) {
    return { message: `Xe ${parsed.entities.licensePlate} không thuộc tài khoản của bạn.`, context: {} };
  }
  if (!plate) return { message: choosePlateMessage(data), context: {} };
  const session = await findOwnedSession(userId, plate, data, false);
  if (!session) return { message: `Chưa có lượt đỗ nào của xe ${plate}.`, context: { licensePlate: plate } };
  const context = sessionContext(session, plate);
  const active = session.status === 'active';
  if (intent === 'CHECK_VEHICLE_PARKING_STATUS') {
    return { message: active
      ? `Xe ${plate} đang ở trong bãi, vào lúc ${vnTime(session.checkInTime)}.`
      : session.status === 'completed'
        ? `Xe ${plate} đã rời bãi lúc ${vnTime(session.checkOutTime)}.`
        : `Lượt đỗ gần nhất của xe ${plate} đã bị hủy.`, context };
  }
  if (intent === 'CHECK_VEHICLE_ENTRY_TIME') {
    if (session.status === 'cancelled') {
      return { message: `Lượt đỗ gần nhất của xe ${plate} đã bị hủy nên không có giờ vào bãi thực tế.`, context };
    }
    if (!session.checkInTime) return { message: `Chưa ghi nhận giờ vào bãi của xe ${plate}.`, context };
    return { message: `Xe ${plate} vào bãi lúc ${vnDateTime(session.checkInTime)}.`, context };
  }
  if (intent === 'CHECK_VEHICLE_EXIT_TIME') {
    return { message: active
      ? `Xe ${plate} vẫn đang trong bãi, chưa có giờ ra.`
      : session.checkOutTime ? `Xe ${plate} ra bãi lúc ${vnDateTime(session.checkOutTime)}.` : `Chưa có giờ ra của xe ${plate}.`, context };
  }
  if (intent === 'CHECK_VEHICLE_LOCATION') {
    if (!active) return { message: `Xe ${plate} hiện không có phiên đỗ đang hoạt động.`, context };
    const floor = session.floorId?.name || (session.floorId?.floorNumber ? `Tầng ${session.floorId.floorNumber}` : 'chưa xác định tầng');
    return { message: `Xe ${plate} đang ở ${floor}, ô ${session.parkingSlot || 'chưa xác định'}.`, context };
  }
  if (intent === 'CHECK_VEHICLE_DURATION') {
    if (session.status === 'cancelled') {
      return { message: `Lượt đỗ gần nhất của xe ${plate} đã bị hủy nên không phát sinh thời gian đỗ.`, context };
    }
    if (!session.checkInTime || (!active && !session.checkOutTime)) {
      return { message: `Phiên đỗ gần nhất của xe ${plate} chưa có đủ giờ vào và giờ ra để tính thời gian.`, context };
    }
    return { message: `Xe ${plate} đã đỗ ${durationText(session.checkInTime, active ? now : session.checkOutTime || now)}.`, context };
  }
  if (session.status === 'cancelled') {
    return { message: `Lượt đỗ gần nhất của xe ${plate} đã bị hủy nên không phát sinh phí đỗ.`, context };
  }
  const pricing = active
    ? await pricingEngine.calculatePrice(session.checkInTime, now)
    : null;
  const fee = active ? pricing.finalTotal : Number(session.totalPrice || 0);
  return { message: active
    ? `Phí tạm tính của xe ${plate} là ${money(fee)}.`
    : `Phí lượt đỗ gần nhất của xe ${plate} là ${money(fee)}.`, context,
  };
}

const bookingStatusText = (status) => ({
  PENDING: 'chờ thanh toán', PAID: 'đã thanh toán, chờ vào bãi', ACTIVE: 'đang đỗ',
  PAUSED: 'đang tạm dừng', EXPIRED: 'đã hết hạn', COMPLETED: 'đã hoàn tất', CANCELLED: 'đã hủy',
}[status] || String(status || '').toLowerCase());

async function handleBookingIntent(intent, parsed, userId, now) {
  const lastConflict = parsed.draft?.assistantContext?.lastBookingConflict;
  const requestedPlate = compactPlate(parsed.entities.licensePlate || lastConflict?.licensePlate || '');
  const conflictPlate = compactPlate(lastConflict?.licensePlate || '');
  if (intent === 'CHECK_BOOKING_STATUS' && requestedPlate && requestedPlate === conflictPlate) {
    if (lastConflict.code === 'LICENSE_PLATE_BOOKING_CONFLICT') {
      return {
        message: `Biển số ${requestedPlate} đang được dùng bởi một booking còn hiệu lực trên hệ thống. Booking đó không thuộc tài khoản của bạn nên không thể hiển thị chi tiết. Hãy chọn xe đã đăng ký trong tài khoản hoặc đăng ký/xác minh biển số này.`,
        context: { licensePlate: requestedPlate },
      };
    }
    if (lastConflict.code === 'VEHICLE_BOOKING_OVERLAP' && lastConflict.conflictBooking) {
      const conflict = lastConflict.conflictBooking;
      return {
        message: `Booking đang gây trùng của xe ${requestedPlate}: ${vnDateTime(conflict.scheduledStart)}–${vnDateTime(conflict.scheduledEnd)}, ô ${conflict.parkingSlot || 'chưa xác định'}. Trạng thái: ${bookingStatusText(conflict.status)}.`,
        context: { bookingId: conflict.bookingId || '', licensePlate: requestedPlate, slotCode: conflict.parkingSlot || '' },
      };
    }
  }

  const approvedPlates = await Vehicle.find({ owner: userId, status: 'approved' }).distinct('licensePlate');
  const ownership = [{ userId }];
  if (approvedPlates.length) ownership.push({ licensePlate: { $in: approvedPlates.map(compactPlate) } });
  const query = { $or: ownership };
  if (parsed.entities.licensePlate) query.licensePlate = parsed.entities.licensePlate;
  if (intent === 'CHECK_UPCOMING_BOOKING') {
    query.status = { $in: ['PENDING', 'PAID'] };
    query.scheduledEnd = { $gt: now };
  }
  if (parsed.entities.bookingId) query._id = parsed.entities.bookingId;
  let historyFallback = false;
  let booking;
  if (intent === 'CHECK_BOOKING_STATUS' || intent === 'CHECK_PAYMENT_STATUS') {
    booking = await Booking.findOne({
      ...query,
      status: { $in: ['PENDING', 'PAID', 'ACTIVE', 'PAUSED'] },
      scheduledEnd: { $gt: now },
    }).sort({ scheduledStart: 1 }).populate('floorId', 'name floorNumber').lean();
    if (!booking) {
      historyFallback = true;
      booking = await Booking.findOne(query).sort({ createdAt: -1 })
        .populate('floorId', 'name floorNumber').lean();
    }
  } else {
    booking = await Booking.findOne(query).sort(intent === 'CHECK_UPCOMING_BOOKING'
      ? { scheduledStart: 1 } : { createdAt: -1 }).populate('floorId', 'name floorNumber').lean();
  }
  if (!booking) return { message: intent === 'CHECK_UPCOMING_BOOKING'
    ? 'Bạn không có booking sắp tới.' : 'Mình không tìm thấy booking phù hợp trong tài khoản của bạn.', context: {} };
  const context = {
    bookingId: idOf(booking._id), licensePlate: booking.licensePlate,
    floorName: booking.floorId?.name || '', slotCode: booking.parkingSlot || '',
  };
  if (intent === 'CHECK_PAYMENT_STATUS') {
    const paid = ['PAID', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(booking.status);
    return { message: paid
      ? `Booking xe ${booking.licensePlate} đã thanh toán ${money(booking.prepaidAmount)}.`
      : `Booking xe ${booking.licensePlate} ${bookingStatusText(booking.status)}.`, context };
  }
  return {
    message: `${intent === 'CHECK_UPCOMING_BOOKING'
      ? 'Booking sắp tới'
      : historyFallback
        ? 'Xe không có booking đang hiệu lực. Lịch sử gần nhất'
        : 'Booking đang hiệu lực'}: xe ${booking.licensePlate}, ${vnDateTime(booking.scheduledStart)}–${vnTime(booking.scheduledEnd)}, ${booking.floorId?.name || 'chưa có tầng'}, ô ${booking.parkingSlot}. Trạng thái: ${bookingStatusText(booking.status)}.`,
    context,
  };
}

async function handleSlotStatus(parsed, now) {
  const { slotCode, floorName, zoneName } = parsed.entities;
  if (!slotCode) return { message: 'Bạn muốn kiểm tra ô nào? Ví dụ: “Ô A10 còn trống không?”.', context: {} };
  const slots = await Slot.find({ slotNumber: new RegExp(`^${escapeRegex(slotCode)}$`, 'i') })
    .populate('floorID', 'name floorNumber').populate('zoneID', 'zoneName').lean();
  const filtered = slots.filter((slot) => (!floorName || fold(slot.floorID?.name).includes(fold(floorName))
    || String(slot.floorID?.floorNumber) === String(floorName).replace(/\D/g, ''))
    && (!zoneName || fold(slot.zoneID?.zoneName) === fold(zoneName)));
  if (!filtered.length) return { message: `Không tìm thấy ô ${slotCode}.`, context: { slotCode } };
  if (filtered.length > 1) {
    return { message: `Có nhiều ô ${slotCode}. Hãy nói thêm tầng: ${filtered.map((slot) => slot.floorID?.name).filter(Boolean).join(', ')}.`, context: { slotCode } };
  }
  const slot = filtered[0];
  const floorId = slot.floorID?._id || slot.floorID;
  const [session, booking, hold] = await Promise.all([
    Session.findOne({ status: 'active', floorId, parkingSlot: new RegExp(`^${escapeRegex(slot.slotNumber)}$`, 'i') }).lean(),
    Booking.findOne({ floorId, parkingSlot: new RegExp(`^${escapeRegex(slot.slotNumber)}$`, 'i'), status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] }, scheduledStart: { $lte: now }, scheduledEnd: { $gt: now } }).lean(),
    BookingHold.findOne({ floorId, slotCode: slot.slotNumber.toUpperCase(), status: 'active', expiresAt: { $gt: now }, startTime: { $lte: now }, endTime: { $gt: now } }).lean(),
  ]);
  const unavailable = slot.status === 'maintenance' || slot.reservedFor || slot.reservedBySubscriptionId
    || slot.reservedByEntitlementId || session || booking || hold || ['occupied', 'booked'].includes(slot.status);
  const reason = slot.status === 'maintenance' ? 'đang bảo trì'
    : (session ? 'đang có xe đỗ' : booking || hold ? 'đã được giữ/đặt' : unavailable ? 'đang được dành riêng' : 'đang trống');
  return {
    message: `Ô ${slot.slotNumber}, ${slot.floorID?.name || 'chưa xác định tầng'} ${reason}.`,
    context: { slotCode: slot.slotNumber, floorName: slot.floorID?.name || '', zoneName: slot.zoneID?.zoneName || '' },
  };
}

async function handleLiveAvailability(parsed, now) {
  const slots = await Slot.find({}).populate('floorID', 'name floorNumber')
    .populate('zoneID', 'zoneName').lean();
  const matching = slots.filter((slot) => {
    const slotType = fold(slot.slotType || 'hourly');
    const compatibleType = parsed.entities.vehicleType === 'electric_car'
      ? ['hourly', 'slot', 'standard', 'ev'].includes(slotType)
      : ['hourly', 'slot', 'standard'].includes(slotType);
    const floorMatches = !parsed.entities.floorName
      || fold(slot.floorID?.name).includes(fold(parsed.entities.floorName))
      || String(slot.floorID?.floorNumber) === String(parsed.entities.floorName).replace(/\D/g, '');
    const zoneMatches = !parsed.entities.zoneName
      || fold(slot.zoneID?.zoneName) === fold(parsed.entities.zoneName)
      || fold(slot.zoneID?.zoneName).includes(fold(parsed.entities.zoneName));
    return compatibleType && floorMatches && zoneMatches;
  });
  if (!matching.length) return { message: 'Không tìm thấy tầng hoặc khu đỗ phù hợp.', context: {} };
  const floorIds = [...new Set(matching.map((slot) => idOf(slot.floorID)))];
  const [sessions, bookings, holds] = await Promise.all([
    Session.find({ status: 'active', floorId: { $in: floorIds } }).select('floorId parkingSlot').lean(),
    Booking.find({ status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] }, floorId: { $in: floorIds }, scheduledStart: { $lte: now }, scheduledEnd: { $gt: now } }).select('floorId parkingSlot').lean(),
    BookingHold.find({ status: 'active', expiresAt: { $gt: now }, floorId: { $in: floorIds }, startTime: { $lte: now }, endTime: { $gt: now } }).select('floorId slotCode').lean(),
  ]);
  const used = new Set([
    ...sessions.map((item) => `${idOf(item.floorId)}:${String(item.parkingSlot).toUpperCase()}`),
    ...bookings.map((item) => `${idOf(item.floorId)}:${String(item.parkingSlot).toUpperCase()}`),
    ...holds.map((item) => `${idOf(item.floorId)}:${String(item.slotCode).toUpperCase()}`),
  ]);
  const available = matching.filter((slot) => slot.status === 'available'
    && !slot.reservedFor && !slot.reservedBySubscriptionId && !slot.reservedByEntitlementId
    && !used.has(`${idOf(slot.floorID)}:${String(slot.slotNumber).toUpperCase()}`));
  const floorLabel = parsed.entities.floorName
    ? (/^(?:tầng|floor)\b/i.test(parsed.entities.floorName) ? parsed.entities.floorName : `tầng ${parsed.entities.floorName}`)
    : '';
  const label = [floorLabel, parsed.entities.zoneName && `khu ${parsed.entities.zoneName}`]
    .filter(Boolean).join(', ') || 'bãi';
  const suggestions = available.slice(0, 5).map((slot) => `${slot.floorID?.name} · ${slot.slotNumber}`);
  return {
    message: `Hiện ${label} còn ${available.length}/${matching.length} ô trống.${suggestions.length ? ` Gợi ý: ${suggestions.join(', ')}.` : ''}`,
    context: { floorName: parsed.entities.floorName, zoneName: parsed.entities.zoneName },
  };
}

async function handleWallet(intent, userId) {
  if (intent === 'CHECK_WALLET_BALANCE') {
    const wallet = await Wallet.findOne({ userId }).lean();
    return { message: `Số dư ví hiện tại là ${money(wallet?.balance || 0)}.`, context: {} };
  }
  const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
  if (!transactions.length) return { message: 'Bạn chưa có giao dịch ví nào.', context: {} };
  const labels = { TOP_UP: 'Nạp tiền', PAYMENT: 'Thanh toán', REFUND: 'Hoàn tiền', TRANSFER_OUT: 'Chuyển đi', TRANSFER_IN: 'Nhận tiền', TRANSFER_FEE: 'Phí chuyển' };
  const statuses = { COMPLETED: 'thành công', PENDING: 'đang xử lý', FAILED: 'thất bại', CANCELLED: 'đã hủy' };
  return {
    message: `5 giao dịch gần nhất:\n${transactions.map((item) => `- ${vnDateTime(item.createdAt)}: ${labels[item.type] || item.type} ${money(item.amount)} · ${statuses[item.status] || 'chưa xác định'}`).join('\n')}`,
    context: {},
  };
}

async function handleVehicles(intent, parsed, userId) {
  const vehicles = await Vehicle.find({ owner: userId }).sort({ isDefault: -1, createdAt: -1 }).lean();
  if (intent === 'LIST_MY_VEHICLES') {
    if (!vehicles.length) return { message: 'Bạn chưa đăng ký xe nào.', context: {} };
    return { message: `Xe trong tài khoản:\n${vehicles.map((item) => `- ${item.licensePlate}${item.nickname ? ` · ${item.nickname}` : ''} · ${item.status === 'approved' ? 'đã duyệt' : item.status === 'pending' ? 'chờ duyệt' : 'bị từ chối'}`).join('\n')}`, context: {} };
  }
  const prior = parsed.entities.pendingAction || {};
  const plate = parsed.entities.licensePlate || prior.licensePlate || '';
  if (intent === 'REMOVE_VEHICLE') {
    if (!plate) return {
      message: `Bạn muốn xóa xe nào? ${vehicles.map((item) => item.licensePlate).join(', ') || 'Tài khoản chưa có xe.'}`,
      pendingActionDraft: { type: intent }, context: {},
    };
    const target = vehicles.find((item) => compactPlate(item.licensePlate) === plate);
    if (!target) return { message: `Không tìm thấy xe ${plate} trong tài khoản.`, context: {} };
    return { message: `Xác nhận xóa xe ${plate}?`, pendingAction: { type: intent, vehicleId: idOf(target._id), licensePlate: plate }, context: { licensePlate: plate } };
  }
  if (intent === 'ADD_VEHICLE') {
    const action = { type: intent, licensePlate: plate, ...prior, ...parsed.entities.vehicleChanges };
    if (!action.licensePlate) return { message: 'Bạn muốn thêm biển số nào?', pendingActionDraft: action, context: {} };
    if (!action.brand) return { message: `Xe ${action.licensePlate} thuộc hãng nào?`, pendingActionDraft: action, context: { licensePlate: action.licensePlate } };
    if (!action.vehicleType) return { message: 'Đây là ô tô thường hay ô tô điện?', pendingActionDraft: action, context: { licensePlate: action.licensePlate } };
    return { message: `Xác nhận thêm xe ${action.licensePlate}, hãng ${action.brand}, loại ${action.vehicleType === 'electric_car' ? 'ô tô điện' : 'ô tô thường'}?`, pendingAction: action, context: { licensePlate: action.licensePlate } };
  }
  if (!plate) return {
    message: `Bạn muốn sửa xe nào? ${vehicles.map((item) => item.licensePlate).join(', ') || 'Tài khoản chưa có xe.'}`,
    pendingActionDraft: { type: intent, changes: {} }, context: {},
  };
  const target = vehicles.find((item) => compactPlate(item.licensePlate) === plate);
  if (!target) return { message: `Không tìm thấy xe ${plate} trong tài khoản.`, context: {} };
  const changes = { ...prior.changes, ...parsed.entities.vehicleChanges };
  if (!Object.keys(changes).length) return { message: 'Bạn muốn đổi tên, hãng, màu, loại xe hay biển số?', pendingActionDraft: { type: intent, vehicleId: idOf(target._id), licensePlate: plate, changes: {} }, context: { licensePlate: plate } };
  return { message: `Xác nhận cập nhật xe ${plate}?`, pendingAction: { type: intent, vehicleId: idOf(target._id), licensePlate: plate, changes }, context: { licensePlate: plate } };
}

async function handleServices(intent, parsed) {
  const services = await Service.find({ isActive: true }).sort({ name: 1 }).lean();
  if (!services.length) return { message: 'Hiện chưa có dịch vụ đang hoạt động.', context: {} };
  if (intent === 'CHECK_SERVICES') {
    return { message: `Dịch vụ hiện có:\n${services.map((item) => `- ${item.name}: ${money(item.price)} · khoảng ${item.timeCost} phút`).join('\n')}`, context: {} };
  }
  const requested = fold(parsed.entities.serviceName || parsed.rawText);
  const exact = requested ? services.filter((item) => fold(item.name) === requested) : [];
  const selected = exact.length ? exact : requested ? services.filter((item) => {
    const itemName = fold(item.name);
    return itemName.includes(requested) || requested.includes(itemName)
      || (requested.includes('water spot') && itemName.includes('water spot'))
      || (requested.includes('coating') && itemName.includes('coating'))
      || (requested.includes('car wash') && itemName.includes('wash'))
      || (requested.includes('rua xe') && itemName.includes('wash'))
      || (requested.includes('polishing') && itemName.includes('polishing'))
      || (requested.includes('scratch') && itemName.includes('scratch'))
      || (requested.includes('cleaning') && itemName.includes('cleaning'));
  }) : [];

  const priorDraft = parsed.draft || {};
  const bookingPatch = Object.fromEntries([
    'startDate', 'endDate', 'startTime', 'endTime', 'licensePlate',
    'floorName', 'zoneName', 'slotCode', 'vehicleType', 'requestedVehicleCount',
  ].map((field) => [field, parsed.entities[field] || priorDraft[field]]).filter(([, value]) => value));
  if (parsed.entities.licensePlates?.length || priorDraft.licensePlates?.length) {
    bookingPatch.licensePlates = parsed.entities.licensePlates?.length ? parsed.entities.licensePlates : priorDraft.licensePlates;
  }
  if (priorDraft.reservationItems?.length) {
    bookingPatch.reservationItems = priorDraft.reservationItems;
    if (priorDraft.reservationItems.length > 1 && priorDraft.licensePlate) {
      bookingPatch.licensePlate = priorDraft.licensePlate;
    }
  }
  if (priorDraft.vehicleId) {
    bookingPatch.vehicleId = priorDraft.vehicleId;
  }

  const existingServiceIds = Array.isArray(priorDraft.serviceIds) ? priorDraft.serviceIds : [];
  const existingServiceNames = Array.isArray(priorDraft.serviceNames) ? priorDraft.serviceNames : [];
  if (!selected.length) return {
    message: `Mình đã giữ lại thông tin đặt chỗ. Bạn muốn chọn dịch vụ nào? ${services.map((item) => item.name).join(', ')}.`,
    context: {},
    transition: {
      intent: 'CREATE_BOOKING',
      draftPatch: { ...bookingPatch, serviceIds: existingServiceIds, serviceNames: existingServiceNames },
    },
  };
  if (selected.length > 1) return {
    message: `Có nhiều dịch vụ phù hợp: ${selected.map((item) => item.name).join(', ')}. Hãy nói chính xác một tên dịch vụ để mình không chọn nhầm.`,
    context: {},
    transition: {
      intent: 'CREATE_BOOKING',
      draftPatch: { ...bookingPatch, serviceIds: existingServiceIds, serviceNames: existingServiceNames },
    },
  };

  const hasVehicle = Boolean(bookingPatch.licensePlate || bookingPatch.licensePlates?.length);
  const missing = [];
  if (!bookingPatch.startDate) missing.push('ngày bắt đầu');
  if (!bookingPatch.startTime) missing.push('giờ vào');
  if (!bookingPatch.endTime) missing.push('giờ ra');
  if (!hasVehicle) missing.push('xe hoặc biển số');
  const hasPriorBooking = missing.length === 0;
  const isRemoving = /\b(bo|xoa|huy|khong\s+lay|khong\s+can|remove|delete|cancel)\b/i.test(parsed.rawText);
  let nextServiceIds, nextServiceNames, message;
  const targetPlate = bookingPatch.licensePlate || bookingPatch.licensePlates?.[0] || '';
  const selectedIds = selected.map((item) => idOf(item._id));
  const selectedNames = selected.map((item) => item.name);
  const selectedLabel = selected.map((item) => `${item.name} (${money(item.price)})`).join(', ');
  const reservationItems = Array.isArray(priorDraft.reservationItems) ? priorDraft.reservationItems : [];
  const directlyNamedPlate = extractLicensePlates(parsed.rawText).map(compactPlate).find(Boolean) || '';

  if (reservationItems.length > 1 && !directlyNamedPlate) {
    return {
      message: `Booking có nhiều xe. Bạn muốn ${isRemoving ? 'bỏ' : 'thêm'} dịch vụ ${selectedNames.join(', ')} cho xe nào? ${reservationItems.map((item) => item.licensePlate).filter(Boolean).join(', ')}.`,
      context: {},
      transition: {
        intent: 'CREATE_BOOKING',
        draftPatch: { ...bookingPatch, serviceIds: existingServiceIds, serviceNames: existingServiceNames },
      },
    };
  }

  if (reservationItems.length > 1 && directlyNamedPlate) {
    const hasTarget = reservationItems.some((item) => compactPlate(item.licensePlate) === directlyNamedPlate);
    if (!hasTarget) return {
      message: `Biển số ${directlyNamedPlate} không nằm trong booking đang tạo. Các xe hiện có: ${reservationItems.map((item) => item.licensePlate).filter(Boolean).join(', ')}.`,
      context: {},
      transition: { intent: 'CREATE_BOOKING', draftPatch: bookingPatch },
    };
    const nextReservationItems = reservationItems.map((item) => {
      const baseIds = Array.isArray(item.serviceIds) ? item.serviceIds.map(String) : existingServiceIds.map(String);
      const baseNames = Array.isArray(item.serviceNames) ? item.serviceNames : existingServiceNames;
      if (compactPlate(item.licensePlate) !== directlyNamedPlate) {
        return { ...item, serviceIds: baseIds, serviceNames: baseNames };
      }
      return {
        ...item,
        serviceIds: isRemoving
          ? baseIds.filter((id) => !selectedIds.includes(id))
          : [...new Set([...baseIds, ...selectedIds])],
        serviceNames: isRemoving
          ? baseNames.filter((name) => !selectedNames.includes(name))
          : [...new Set([...baseNames, ...selectedNames])],
      };
    });
    return {
      message: `Đã ${isRemoving ? 'bỏ' : 'thêm'} dịch vụ ${selectedLabel} ${isRemoving ? 'khỏi' : 'cho'} xe ${directlyNamedPlate}.`,
      context: {},
      transition: {
        intent: 'CREATE_BOOKING',
        draftPatch: {
          ...bookingPatch,
          reservationItems: nextReservationItems,
          serviceIds: [],
          serviceNames: [],
        },
      },
    };
  }

  if (isRemoving) {
    nextServiceIds = existingServiceIds.filter((id) => !selectedIds.includes(String(id)));
    nextServiceNames = existingServiceNames.filter((name) => !selectedNames.includes(name));
    message = `Đã bỏ dịch vụ ${selectedNames.join(', ')} khỏi đơn đặt chỗ.`;
  } else {
    nextServiceIds = [...new Set([...existingServiceIds.map(String), ...selectedIds])];
    nextServiceNames = [...new Set([...existingServiceNames, ...selectedNames])];
    message = hasPriorBooking
      ? `Đã thêm dịch vụ ${selectedLabel} vào đơn đặt xe${targetPlate ? ` ${targetPlate}` : ''}.`
      : `Đã chọn ${selectedLabel}. Hãy cho mình ${missing.join(', ')} để hoàn tất thông tin đặt chỗ.`;
  }

  return {
    message,
    context: {},
    transition: {
      intent: 'CREATE_BOOKING',
      draftPatch: {
        ...bookingPatch,
        serviceIds: nextServiceIds,
        serviceNames: nextServiceNames,
      },
    },
  };
}

const voucherBenefitText = (voucher) => {
  const benefit = voucher?.benefitSnapshot || {};
  if (benefit.type === 'PERCENT_DISCOUNT') return `giảm ${Number(benefit.discountPercent || 0)}%`;
  if (benefit.type === 'FIXED_DISCOUNT') return `giảm ${money(benefit.discountAmount)}`;
  if (benefit.type === 'FREE_SERVICE') return `miễn phí ${benefit.serviceId?.name || 'một dịch vụ'}`;
  return 'ưu đãi booking';
};

async function handleVouchers(intent, parsed, userId, now) {
  const vouchers = await UserVoucher.find({
    userId,
    status: 'available',
    bookingId: null,
    expiresAt: { $gt: now },
  }).populate('benefitSnapshot.serviceId', 'name').sort({ expiresAt: 1, createdAt: 1 }).lean();
  if (!vouchers.length) return { message: 'Bạn hiện không có voucher khả dụng.', context: {} };
  const lines = vouchers.map((voucher) => `- ${voucher.benefitSnapshot?.name || 'Voucher'}: ${voucherBenefitText(voucher)}, hết hạn ${formatDate(voucher.expiresAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  if (intent === 'CHECK_VOUCHERS') {
    return { message: `Voucher khả dụng của bạn:\n${lines.join('\n')}\nBạn có thể nói “Dùng voucher <tên>” cho booking đang tạo.`, context: {} };
  }

  const removing = /\b(bo|xoa|huy|remove|clear)\b/.test(fold(parsed.rawText));
  const priorDraft = parsed.draft || {};
  if (removing) return {
    message: 'Đã bỏ voucher khỏi booking đang tạo.',
    context: {},
    transition: { intent: 'CREATE_BOOKING', draftPatch: { voucherId: '', voucherName: '' } },
  };

  const raw = fold(parsed.rawText);
  const matchesByName = vouchers.filter((voucher) => raw.includes(fold(voucher.benefitSnapshot?.name || '')));
  const selected = matchesByName.length === 1 ? matchesByName[0] : vouchers.length === 1 ? vouchers[0] : null;
  if (!selected) return {
    message: `Bạn muốn dùng voucher nào?\n${lines.join('\n')}`,
    context: {},
  };
  const vehicleCount = Math.max(
    Number(priorDraft.requestedVehicleCount || 0),
    Array.isArray(priorDraft.reservationItems) ? priorDraft.reservationItems.length : 0,
    Array.isArray(priorDraft.licensePlates) ? priorDraft.licensePlates.length : 0,
  );
  return {
    message: `Đã chọn voucher ${selected.benefitSnapshot?.name || 'ưu đãi'} (${voucherBenefitText(selected)})${vehicleCount > 1 ? ' cho xe đầu tiên; mỗi voucher chỉ dùng cho một booking xe.' : ''}.`,
    context: {},
    transition: {
      intent: 'CREATE_BOOKING',
      draftPatch: {
        voucherId: idOf(selected._id),
        voucherName: selected.benefitSnapshot?.name || 'Voucher',
      },
    },
  };
}

async function handlePolicies(parsed) {
  const policies = await Policy.find({ status: 'published', deletedAt: null })
    .populate('currentVersionId', 'title summary content effectiveDate').sort({ updatedAt: -1 }).lean();
  if (!policies.length) return { message: 'Hiện chưa có chính sách được công bố.', context: {} };
  const words = fold(parsed.rawText).split(' ').filter((word) => word.length > 3);
  const genericWords = new Set(['chinh', 'sach', 'dinh', 'parking', 'policy', 'rules', 'terms']);
  const specificWords = words.filter((word) => !genericWords.has(word));
  const scoringWords = specificWords.length ? specificWords : words;
  const ranked = policies.map((policy) => ({ policy, score: scoringWords.filter((word) => fold(`${policy.title} ${policy.category} ${policy.description}`).includes(word)).length }))
    .sort((a, b) => b.score - a.score);
  if (specificWords.length && !ranked[0]?.score) {
    return { message: `Mình chưa tìm thấy chính sách phù hợp với nội dung bạn hỏi. Các nhóm chính sách hiện có: ${policies.slice(0, 5).map((policy) => policy.title).join(', ')}.`, context: {} };
  }
  const selected = (ranked[0]?.score ? ranked.filter((item) => item.score === ranked[0].score) : ranked).slice(0, 3).map((item) => item.policy);
  const brief = (policy) => String(policy.currentVersionId?.summary || policy.description || policy.currentVersionId?.content || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260);
  const policySummary = selected.map((policy) => `- ${policy.title}: ${brief(policy) || 'Xem nội dung chi tiết trong trang Chính sách.'}`).join('\n');
  const asksRefund = /\b(huy|hoan tien|refund|cancellation)\b/.test(fold(parsed.rawText));
  const refundPolicy = policies.find((policy) => policy.controlsBookingRefunds && policy.currentVersionId?._id);
  if (!asksRefund || !refundPolicy) return { message: policySummary, context: {} };

  const rule = await RefundRuleVersion.findOne({
    policyVersionId: refundPolicy.currentVersionId._id,
    status: 'published',
  }).lean();
  if (!rule?.cancellationTiers?.length) return { message: policySummary, context: {} };
  const tiers = [...rule.cancellationTiers]
    .sort((left, right) => Number(right.minimumMinutesBeforeStart) - Number(left.minimumMinutesBeforeStart))
    .map((tier) => Number(tier.minimumMinutesBeforeStart) > 0
      ? `- Hủy trước giờ bắt đầu ít nhất ${tier.minimumMinutesBeforeStart} phút: hoàn ${tier.refundPercent}% phí đỗ.`
      : `- Trường hợp còn lại trước giờ bắt đầu: hoàn ${tier.refundPercent}% phí đỗ.`);
  return {
    message: `Chính sách hoàn tiền đang áp dụng:\n${tiers.join('\n')}\nPhí dịch vụ gia tăng không được hoàn khi hủy booking.`,
    context: {},
  };
}

async function handleTicketPackages(intent, parsed) {
  const TicketPackage = require('../models/TicketPackage');
  const packages = await TicketPackage.find({ isActive: true }).sort({ price: 1 }).lean();
  if (!packages.length) {
    return {
      message: 'Hiện chưa có gói vé VIP mở bán. Bạn có thể tiếp tục đặt chỗ theo giờ hoặc liên hệ quản trị viên.',
      context: {},
      showVipModal: true,
    };
  }
  const lines = packages.map((pkg) => {
    const typeLabel = pkg.type === 'monthly' ? 'Gói tháng' : pkg.type === 'yearly' ? 'Gói năm' : 'Gói VIP';
    const features = Array.isArray(pkg.features) && pkg.features.length ? ` · Quyền lợi: ${pkg.features.slice(0, 3).join(', ')}` : '';
    return `- ${pkg.name} (${typeLabel}): ${money(pkg.price)}${features}`;
  });
  return {
    message: `VALO hiện có các Gói VIP:\n${lines.join('\n')}\nMình đã mở bảng Gói VIP để bạn xem đầy đủ quyền lợi và điều kiện của từng gói.`,
    context: {},
    showVipModal: true,
  };
}

async function executeOne(intent, parsed, userId, now) {
  if (['CHECK_VEHICLE_PARKING_STATUS', 'CHECK_VEHICLE_ENTRY_TIME', 'CHECK_VEHICLE_EXIT_TIME', 'CHECK_VEHICLE_LOCATION', 'CHECK_VEHICLE_DURATION', 'CHECK_PARKING_FEE'].includes(intent)) {
    return handleVehicleSessionIntent(intent, parsed, userId, now);
  }
  if (['CHECK_BOOKING_STATUS', 'CHECK_UPCOMING_BOOKING', 'CHECK_PAYMENT_STATUS'].includes(intent)) return handleBookingIntent(intent, parsed, userId, now);
  if (intent === 'CHECK_PARKING_AVAILABILITY') return handleLiveAvailability(parsed, now);
  if (intent === 'CHECK_SLOT_STATUS') return handleSlotStatus(parsed, now);
  if (['CHECK_WALLET_BALANCE', 'CHECK_TRANSACTION_HISTORY'].includes(intent)) return handleWallet(intent, userId);
  if (['LIST_MY_VEHICLES', 'ADD_VEHICLE', 'UPDATE_VEHICLE', 'REMOVE_VEHICLE'].includes(intent)) return handleVehicles(intent, parsed, userId);
  if (['CHECK_SERVICES', 'BOOK_SERVICE'].includes(intent)) return handleServices(intent, parsed);
  if (['CHECK_VOUCHERS', 'USE_VOUCHER'].includes(intent)) return handleVouchers(intent, parsed, userId, now);
  if (intent === 'CHECK_PARKING_POLICY') return handlePolicies(parsed);
  if (intent === 'CHECK_TICKET_PACKAGES') return handleTicketPackages(intent, parsed);
  if (intent === 'HELP') return {
    message: 'Mình có thể đặt chỗ; kiểm tra xe đang ở đâu, giờ vào/ra, thời gian và phí đỗ; xem booking, chỗ trống, ví, giao dịch, xe, dịch vụ và chính sách. Bạn muốn kiểm tra gì?', context: {},
  };
  return { message: 'Mình chưa hiểu yêu cầu. Bạn có thể hỏi vị trí xe, phí đỗ, booking, chỗ trống, ví, xe, dịch vụ hoặc chính sách.', context: {} };
}

async function executeAssistantRequest(parsed, userId, now = new Date()) {
  const outputs = [];
  let mergedContext = {};
  let pendingAction = null;
  let pendingActionDraft = null;
  let transition = null;
  let showVipModal = false;
  for (const intent of parsed.intents.filter((item) => QUERY_INTENTS.has(item))) {
    const result = await executeOne(intent, parsed, userId, now);
    if (result.message && !outputs.includes(result.message)) outputs.push(result.message);
    mergedContext = { ...mergedContext, ...(result.context || {}) };
    pendingAction = result.pendingAction || pendingAction;
    pendingActionDraft = result.pendingActionDraft || pendingActionDraft;
    transition = result.transition || transition;
    showVipModal = result.showVipModal === true || showVipModal;
  }
  return {
    message: outputs.join('\n'),
    context: mergedContext,
    pendingAction,
    pendingActionDraft,
    transition,
    showVipModal,
  };
}

module.exports = {
  QUERY_INTENTS,
  detectIntents,
  executeAssistantRequest,
  fold,
  parseAssistantRequest,
};
