const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const Policy = require('../models/Policy');
const Service = require('../models/Service');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const Vehicle = require('../models/Vehicle');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const pricingEngine = require('./pricingEngine');
const { parseBookingUtterance } = require('./bookingUtteranceParser');
const { isValidCarLicensePlate, normalizeLicensePlate } = require('../utils/licensePlateUtils');

const QUERY_INTENTS = new Set([
  'CHECK_VEHICLE_PARKING_STATUS', 'CHECK_VEHICLE_ENTRY_TIME',
  'CHECK_VEHICLE_EXIT_TIME', 'CHECK_VEHICLE_LOCATION',
  'CHECK_VEHICLE_DURATION', 'CHECK_PARKING_FEE', 'CHECK_BOOKING_STATUS',
  'CHECK_UPCOMING_BOOKING', 'CHECK_PARKING_AVAILABILITY', 'CHECK_SLOT_STATUS', 'CHECK_WALLET_BALANCE',
  'CHECK_PAYMENT_STATUS', 'CHECK_TRANSACTION_HISTORY', 'LIST_MY_VEHICLES',
  'CHECK_SERVICES', 'BOOK_SERVICE', 'CHECK_PARKING_POLICY', 'HELP',
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

  add('HELP', [/\b(tro giup|giup toi|lam duoc gi|huong dan|chuc nang|ho tro gi|ban biet lam gi|hoi gi duoc)\b/]);
  add('ADD_VEHICLE', [/\b(them|dang ky|tao)\s+(xe|phuong tien|bien so)\b/]);
  add('REMOVE_VEHICLE', [/\b(xoa|go|bo)\s+(xe|phuong tien|bien so)\b/]);
  add('UPDATE_VEHICLE', [/\b(sua|cap nhat|doi)\s+(thong tin\s+)?(xe|bien so|ten xe|mau xe)\b/]);
  add('LIST_MY_VEHICLES', [
    /\b(danh sach|liet ke|xem)\s+(cac\s+)?xe\b/,
    /\b(toi|minh)\s+(co|da dang ky)\s+(nhung |cac )?xe\b/,
    /\bxe nao\s+(trong|thuoc)\s+tai khoan\b/,
    /\b(co bao nhieu xe|nhung bien so nao|bien so nao.*da dang ky|xe da dang ky)\b/,
  ]);
  add('CHECK_WALLET_BALANCE', [
    /\b(so du|vi (con|co)|con bao nhieu tien|tien trong vi)\b/,
    /\b(kiem tra|xem).*(vi|so du)\b/,
    /\bvi.*(bao nhieu|du tien|het tien)\b/,
  ]);
  add('CHECK_TRANSACTION_HISTORY', [
    /\b(lich su giao dich|giao dich gan day|cac giao dich|xem giao dich)\b/,
    /\b(nap tien|tru tien|bien dong so du).*(gan nhat|luc nao|khi nao|lich su)\b/,
    /\b(xem|cho xem|kiem tra)?\s*(bien dong so du|lich su nap tien|lich su tru tien)\b/,
  ]);
  add('CHECK_PAYMENT_STATUS', [
    /\b(da thanh toan|thanh toan chua|chua thanh toan|trang thai thanh toan|tra tien chua)\b/,
    /\b(booking|dat cho|don).*(da tra tien|con no|can thanh toan)\b/,
  ]);
  add('CHECK_SERVICES', [
    /\b(co dich vu gi|danh sach dich vu|xem dich vu|dich vu nao|cac dich vu)\b/,
    /\b(co|ho tro)\s+(rua xe|sac xe|cham soc xe)\s+(khong|chua)\b/,
    /\b(rua xe|sac xe|cham soc xe).*(co khong|gia bao nhieu)\b/,
  ]);
  add('BOOK_SERVICE', [
    /\b(dat|them|chon)\s+(dich vu|rua xe|sac xe|cham soc xe)\b/,
    /\b(muon|can)\s+(rua xe|sac xe|cham soc xe)\b/,
  ]);
  add('CHECK_PARKING_POLICY', [
    /\b(chinh sach|quy dinh|noi quy|dieu khoan|hoan tien)\b/,
    /\b(huy booking|huy dat cho).*(mat phi|duoc hoan|hoan bao nhieu)\b/,
    /\b(duoc do|duoc gui).*(toi da|bao lau)\b/,
  ]);
  add('CHECK_UPCOMING_BOOKING', [
    /\b(booking|dat cho).*(sap toi|hom nay|ke tiep)\b/,
    /\b(sap toi|hom nay).*(booking|dat cho)\b/,
    /\b(lich dat|lich do).*(sap toi|hom nay|gan nhat|ke tiep)\b/,
    /\b(hom nay|ngay mai).*(co lich|co booking|da dat cho)\b/,
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
  ]);
  add('CHECK_VEHICLE_ENTRY_TIME', [
    /\b(vao luc may|vao bai luc may|gio vao|vao bai luc|check.?in luc)\b/,
    /\b(vao bai|den bai|gui xe).*(luc nao|khi nao|may gio)\b/,
    /\b(luc nao|khi nao|may gio).*(vao bai|check.?in)\b/,
  ]);
  add('CHECK_VEHICLE_EXIT_TIME', [
    /\b(ra luc may|ra bai luc may|gio ra|da ra (bai )?chua|xe.*ra chua|check.?out luc)\b/,
    /\b(ra bai|roi bai|lay xe).*(luc nao|khi nao|may gio|chua)\b/,
    /\bxe.*da ra ngoai\s+(chua|khong)\b/,
  ]);
  add('CHECK_VEHICLE_LOCATION', [
    /\b(dang o dau|do o dau|xe.*o dau|vi tri (xe|do)|nam o dau|o tang nao|o o nao)\b/,
    /\bxe.*(tang may|tang nao|o nao|khu nao|zone nao)\b/,
    /\b(tim|kiem tra).*vi tri.*xe\b/,
  ]);
  add('CHECK_VEHICLE_DURATION', [
    /\b(da do bao lau|o bai bao lau|thoi gian do|do duoc bao lau)\b/,
    /\b(da gui|gui xe|vao bai).*(bao lau|may phut|may tieng)\b/,
    /\bbao lau.*(trong bai|do xe|gui xe)\b/,
    /\b(o|nam)\s+(o\s+)?trong bai\s+bao lau\b/,
  ]);
  add('CHECK_PARKING_FEE', [
    /\b(phi|tien do|chi phi).*(bao nhieu|tam tinh|hien tai)?\b/,
    /\bbao nhieu tien\b/,
    /\b(tam tinh|hien tai|toi gio).*(het|mat|la)\s+bao nhieu\b/,
    /\bxe.*(het|mat)\s+bao nhieu\s+tien\b/,
  ]);
  add('CHECK_VEHICLE_PARKING_STATUS', [
    /\b(da vao bai chua|co trong bai|dang trong bai|xe dang do|trang thai xe)\b/,
    /\b(co|da)\s+(do|dau)\s+(xe\s+)?chua\b/,
    /\bxe.*(co|da)\s+(do|dau)\s+chua\b/,
    /\bxe.*dang do\b/,
    /\bxe.*(con|co|dang)\s+(o|trong)\s+bai\s+(khong|chua)\b/,
    /\bxe.*(con|co|dang|co dang)\s+o\s+trong\s+bai\s+(khong|chua)\b/,
    /\bxe.*(da vao|vao)\s+bai\s+(chua|khong)\b/,
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
  const context = draft.assistantContext && typeof draft.assistantContext === 'object'
    ? draft.assistantContext : {};
  const pendingType = context.pendingAction?.type;
  if (!intents.length && ['ADD_VEHICLE', 'UPDATE_VEHICLE', 'REMOVE_VEHICLE'].includes(pendingType)) {
    intents = [pendingType];
  }
  if (!intents.length) return null;

  const bookingEntities = parseBookingUtterance(raw, today, draft, currentTime)?.changes || {};
  const directPlates = Array.isArray(bookingEntities.licensePlates) ? bookingEntities.licensePlates : [];
  const licensePlate = compactPlate(bookingEntities.licensePlate || directPlates[0] || context.licensePlate);
  const zone = raw.match(/\b(?:zone|khu)\s*([a-z0-9-]{1,12})\b/i)?.[1]?.toUpperCase() || '';
  const floorName = bookingEntities.floorName || raw.match(/\b(?:tầng|tang|floor)\s*([a-z0-9-]{1,12})\b/i)?.[1] || '';
  const serviceName = raw.match(/\b(?:dịch vụ|dich vu)\s+([^,.;?]{2,60})/i)?.[1]?.trim()
    || (text.includes('rua xe') ? 'rửa xe' : text.includes('sac xe') ? 'sạc xe' : '');
  const entities = {
    licensePlate: isValidCarLicensePlate(licensePlate) ? licensePlate : '',
    licensePlates: directPlates.map(compactPlate).filter(isValidCarLicensePlate),
    floorName: String(floorName || context.floorName || '').trim(),
    zoneName: zone || context.zoneName || '',
    slotCode: extractSlot(raw) || context.slotCode || '',
    startDate: bookingEntities.startDate || '', endDate: bookingEntities.endDate || '',
    startTime: bookingEntities.startTime || '', endTime: bookingEntities.endTime || '',
    serviceName,
    vehicleChanges: extractVehicleChanges(raw, text),
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
  return { intent: intents[0], intents, entities, rawText: raw };
}

async function ownedData(userId) {
  const [vehicles, bookings] = await Promise.all([
    Vehicle.find({ owner: userId }).sort({ isDefault: -1, createdAt: -1 }).lean(),
    Booking.find({ userId }).sort({ scheduledStart: -1 }).lean(),
  ]);
  return { vehicles, bookings };
}

function accessiblePlates(data) {
  return [...new Set([
    ...data.vehicles.map((item) => compactPlate(item.licensePlate)),
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
    ...(plate ? [{ licensePlate: plate }] : []),
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
    return { message: `Xe ${plate} đã đỗ ${durationText(session.checkInTime, active ? now : session.checkOutTime || now)}.`, context };
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
  const query = { userId };
  if (parsed.entities.licensePlate) query.licensePlate = parsed.entities.licensePlate;
  if (intent === 'CHECK_UPCOMING_BOOKING') {
    query.status = { $in: ['PENDING', 'PAID'] };
    query.scheduledEnd = { $gt: now };
  }
  if (parsed.entities.bookingId) query._id = parsed.entities.bookingId;
  const booking = await Booking.findOne(query).sort(intent === 'CHECK_UPCOMING_BOOKING'
    ? { scheduledStart: 1 } : { createdAt: -1 }).populate('floorId', 'name floorNumber').lean();
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
    message: `${intent === 'CHECK_UPCOMING_BOOKING' ? 'Booking sắp tới' : 'Booking gần nhất'}: xe ${booking.licensePlate}, ${vnDateTime(booking.scheduledStart)}–${vnTime(booking.scheduledEnd)}, ${booking.floorId?.name || 'chưa có tầng'}, ô ${booking.parkingSlot}. Trạng thái: ${bookingStatusText(booking.status)}.`,
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
    const floorMatches = !parsed.entities.floorName
      || fold(slot.floorID?.name).includes(fold(parsed.entities.floorName))
      || String(slot.floorID?.floorNumber) === String(parsed.entities.floorName).replace(/\D/g, '');
    const zoneMatches = !parsed.entities.zoneName
      || fold(slot.zoneID?.zoneName) === fold(parsed.entities.zoneName)
      || fold(slot.zoneID?.zoneName).includes(fold(parsed.entities.zoneName));
    return floorMatches && zoneMatches;
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
  const requested = fold(parsed.entities.serviceName);
  const selected = requested ? services.find((item) => fold(item.name).includes(requested) || requested.includes(fold(item.name))) : null;
  if (!selected) return { message: `Bạn muốn chọn dịch vụ nào? ${services.map((item) => item.name).join(', ')}.`, context: {} };
  const bookingPatch = Object.fromEntries([
    'startDate', 'endDate', 'startTime', 'endTime', 'licensePlate',
    'floorName', 'zoneName', 'slotCode',
  ].map((field) => [field, parsed.entities[field]]).filter(([, value]) => value));
  if (parsed.entities.licensePlates?.length) bookingPatch.licensePlates = parsed.entities.licensePlates;
  return {
    message: `Đã chọn ${selected.name} (${money(selected.price)}). Hãy cho mình ngày, giờ và xe để đặt chỗ kèm dịch vụ.`,
    context: {}, transition: {
      intent: 'CREATE_BOOKING',
      draftPatch: { ...bookingPatch, serviceIds: [idOf(selected._id)], serviceNames: [selected.name] },
    },
  };
}

async function handlePolicies(parsed) {
  const policies = await Policy.find({ status: 'published', deletedAt: null })
    .populate('currentVersionId', 'title summary content effectiveDate').sort({ updatedAt: -1 }).lean();
  if (!policies.length) return { message: 'Hiện chưa có chính sách được công bố.', context: {} };
  const words = fold(parsed.rawText).split(' ').filter((word) => word.length > 3);
  const ranked = policies.map((policy) => ({ policy, score: words.filter((word) => fold(`${policy.title} ${policy.category} ${policy.description}`).includes(word)).length }))
    .sort((a, b) => b.score - a.score);
  const selected = (ranked[0]?.score ? ranked.filter((item) => item.score === ranked[0].score) : ranked).slice(0, 3).map((item) => item.policy);
  const brief = (policy) => String(policy.currentVersionId?.summary || policy.description || policy.currentVersionId?.content || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260);
  return { message: selected.map((policy) => `- ${policy.title}: ${brief(policy) || 'Xem nội dung chi tiết trong trang Chính sách.'}`).join('\n'), context: {} };
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
  if (intent === 'CHECK_PARKING_POLICY') return handlePolicies(parsed);
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
  for (const intent of parsed.intents.filter((item) => QUERY_INTENTS.has(item))) {
    const result = await executeOne(intent, parsed, userId, now);
    if (result.message && !outputs.includes(result.message)) outputs.push(result.message);
    mergedContext = { ...mergedContext, ...(result.context || {}) };
    pendingAction = result.pendingAction || pendingAction;
    pendingActionDraft = result.pendingActionDraft || pendingActionDraft;
    transition = result.transition || transition;
  }
  return { message: outputs.join('\n'), context: mergedContext, pendingAction, pendingActionDraft, transition };
}

module.exports = {
  QUERY_INTENTS,
  detectIntents,
  executeAssistantRequest,
  fold,
  parseAssistantRequest,
};
