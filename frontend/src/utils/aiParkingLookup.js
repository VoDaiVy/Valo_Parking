const fold = (value = '') => String(value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const compactPlate = (value = '') => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

export function detectDirectParkingLookup(message) {
  const text = fold(message);
  const plateMatch = text.match(/\b(\d{2})\s*([a-z]{1,2})\s*(\d{4,5})\b/i);
  const licensePlate = plateMatch ? compactPlate(`${plateMatch[1]}${plateMatch[2]}${plateMatch[3]}`) : '';
  const floorMatch = text.match(/\b(?:tang|floor)\s*([a-z]?\d+)\b/i);
  const floorName = floorMatch ? floorMatch[1].toUpperCase() : '';
  const slotMatch = text.match(/\b(?:o|slot)\s*(?:so\s*)?([a-z]{1,3})[-_. ]?(\d{1,5})\b/i)
    || (!licensePlate ? text.match(/\b([a-z]{1,3})[-_. ]?(\d{1,4})\b/i) : null);
  const slotCode = slotMatch ? `${slotMatch[1]}${slotMatch[2]}`.toUpperCase() : '';

  const asksAssignedParking = (licensePlate || /\b(?:xe|toi|minh)\b/.test(text))
    && (/\b(?:da\s+)?co\s+(?:bai do|cho do|o do|cho dat|lich dat|lich do)\b(?:\s+[a-z0-9]+){0,6}\s+(?:chua|khong)\b/.test(text)
      || /\b(?:da\s+)?duoc\s+(?:xep|gan|cap)\s+(?:bai|cho|o)(?:\s+do)?\b(?:\s+[a-z0-9]+){0,6}\s+(?:chua|khong)\b/.test(text));

  const bookingStatus = /\b(?:da|co)\s+(?:dat(?:\s+cho)?|booking)\b(?:\s+[a-z0-9]+){0,6}\s+(?:chua|khong)\b/.test(text)
    || /\b(?:booking|dat cho)\s+(?:chua|khong)\b/.test(text)
    || /\b(?:dat(?:\s+cho)?|booking)\s+(?:ngay nao|luc nao|khi nao)\b/.test(text)
    || /\b(?:ngay nao|luc nao|khi nao)\s+(?:da\s+)?(?:dat(?:\s+cho)?|booking)\b/.test(text)
    || /\b(?:co|da co)\s+(?:lich dat|lich do|booking)\s+(?:chua|khong)\b/.test(text)
    || /\b(?:booking|lich dat)\s+(?:gan nhat|moi nhat)\b/.test(text)
    || /\b(?:da\s+)?co\s+(?:bai do|cho do|o do|cho dat|lich dat|lich do)\s+(?:chua|khong)\b/.test(text)
    || /\b(?:da\s+)?duoc\s+(?:xep|gan|cap)\s+(?:bai|cho|o)(?:\s+do)?\s+(?:chua|khong)\b/.test(text)
    || asksAssignedParking;
  if (bookingStatus) return { intent: 'CHECK_BOOKING_STATUS', licensePlate };

  const parkingStatus = /\b(?:co|da|dang)\s+(?:do|dau)(?:\s+xe)?\s+(?:chua|khong)\b/.test(text)
    || /\b(?:da vao bai chua|co trong bai khong|dang trong bai khong|dang do trong bai)\b/.test(text)
    || /\bxe\b.*\b(?:con|co|dang)\s+(?:o|trong)\s+bai\s+(?:khong|chua)\b/.test(text)
    || /\bxe\b.*\b(?:con|co|dang|co dang)\s+o\s+trong\s+bai\s+(?:khong|chua)\b/.test(text)
    || /\bxe\b.*\b(?:da vao|vao)\s+bai\s+(?:chua|khong)\b/.test(text);
  if (parkingStatus) return { intent: 'CHECK_VEHICLE_PARKING_STATUS', licensePlate };

  const slotStatus = slotCode && /\b(trong|ban|co xe|co ai do|dang dung|dang duoc dung|bi chiem|trang thai|kiem tra)\b/.test(text);
  if (slotStatus) return { intent: 'CHECK_SLOT_STATUS', slotCode, floorName };

  const parkingAvailability = /\bcon\s+(?:bao nhieu\s+)?(?:cho|o)(?:\s+nao)?(?:\s+trong)?\b/.test(text)
    || /\bco\s+(?:cho|o)\s+trong\s+(?:khong|chua)\b/.test(text)
    || /\b(?:cho|o)\s+nao\s+trong\b/.test(text)
    || /\b(?:bai|ham|nha xe)\b.*\b(day|het cho|con cho|con trong)\b/.test(text)
    || /\b(?:tang|floor)\s*[a-z]?\d+\b.*\b(con|co)\b.*\b(cho|o|trong)\b/.test(text)
    || /\b(?:cho|o)\s+trong\b.*\b(con|co|bao nhieu)\b/.test(text);
  if (parkingAvailability) return { intent: 'CHECK_PARKING_AVAILABILITY', floorName };

  return null;
}

const normalizeList = (response) => response?.ok && response?.data?.success
  ? (Array.isArray(response.data.data) ? response.data.data : [])
  : null;

const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
};

export function parkingStatusReply(response, licensePlate) {
  const sessions = normalizeList(response);
  if (!sessions) throw new Error(response?.data?.message || 'Không thể kiểm tra trạng thái xe lúc này.');
  const plate = compactPlate(licensePlate);
  const matching = sessions.filter((item) => !plate || compactPlate(item.licensePlate) === plate);
  if (!plate) return 'Bạn muốn kiểm tra xe nào? Hãy đọc hoặc nhập biển số.';
  const active = matching.find((item) => String(item.status).toLowerCase() === 'active');
  if (active) {
    const location = [active.floorId?.name, active.parkingSlot ? `ô ${active.parkingSlot}` : ''].filter(Boolean).join(', ');
    return `Xe ${plate} đang ở trong bãi${location ? ` tại ${location}` : ''}${active.checkInTime ? `, vào lúc ${formatTime(active.checkInTime)}` : ''}.`;
  }
  return matching.length
    ? `Xe ${plate} hiện không ở trong bãi.`
    : `Không tìm thấy lượt đỗ nào của xe ${plate} trong tài khoản của bạn.`;
}

const bookingState = (status) => ({
  PENDING: 'đang chờ thanh toán', PAID: 'đã đặt và đang chờ vào bãi',
  ACTIVE: 'đang đỗ', PAUSED: 'đang tạm dừng', EXPIRED: 'đã hết hạn',
  COMPLETED: 'đã hoàn tất', CANCELLED: 'đã hủy',
}[String(status || '').toUpperCase()] || String(status || '').toLowerCase());

export function bookingStatusReply(response, licensePlate) {
  const bookings = normalizeList(response);
  if (!bookings) throw new Error(response?.data?.message || 'Không thể kiểm tra booking lúc này.');
  const plate = compactPlate(licensePlate);
  if (!plate) return 'Bạn muốn kiểm tra booking của xe nào? Hãy đọc hoặc nhập biển số.';
  const booking = bookings
    .filter((item) => compactPlate(item.licensePlate) === plate)
    .sort((a, b) => new Date(b.createdAt || b.scheduledStart || 0) - new Date(a.createdAt || a.scheduledStart || 0))[0];
  if (!booking) return `Xe ${plate} chưa có booking nào trong tài khoản của bạn.`;
  const time = formatTime(booking.scheduledStart || booking.startTime);
  const slot = booking.parkingSlot || booking.slotCode;
  return `Booking gần nhất của xe ${plate} ${bookingState(booking.status)}${time ? `, bắt đầu ${time}` : ''}${slot ? `, ô ${slot}` : ''}.`;
}

const liveSlots = (response) => {
  const slots = normalizeList(response);
  if (!slots) throw new Error(response?.data?.message || 'Không thể kiểm tra chỗ trống lúc này.');
  return slots;
};

const sameFloor = (slot, requested) => {
  if (!requested) return true;
  const wanted = fold(requested).replace(/^(tang|floor)\s*/, '');
  const actual = fold(slot.floorName);
  const actualNumber = actual.match(/\b([a-z]?\d+)\b/)?.[1] || '';
  return actual === wanted || actual.includes(wanted) || actualNumber === wanted;
};

export function parkingAvailabilityReply(response, floorName = '') {
  const matching = liveSlots(response).filter((slot) => sameFloor(slot, floorName));
  if (!matching.length) return floorName
    ? `Không tìm thấy tầng ${floorName}.`
    : 'Bãi xe chưa có dữ liệu ô đỗ.';
  const available = matching.filter((slot) => slot.status === 'available');
  if (floorName) {
    const suggestions = available.slice(0, 5).map((slot) => slot.id).join(', ');
    return `Tầng ${floorName} còn ${available.length}/${matching.length} ô trống${suggestions ? `: ${suggestions}` : ''}.`;
  }
  const grouped = new Map();
  for (const slot of matching) {
    const name = slot.floorName || 'Chưa xác định tầng';
    const current = grouped.get(name) || { total: 0, available: 0 };
    current.total += 1;
    if (slot.status === 'available') current.available += 1;
    grouped.set(name, current);
  }
  const details = [...grouped.entries()].map(([name, count]) => `${name}: ${count.available}/${count.total}`).join('; ');
  return `Toàn bãi còn ${available.length}/${matching.length} ô trống. ${details}.`;
}

export function slotStatusReply(response, slotCode, floorName = '') {
  const code = String(slotCode || '').toUpperCase();
  const matching = liveSlots(response).filter((slot) => String(slot.id || '').toUpperCase() === code && sameFloor(slot, floorName));
  if (!matching.length) return `Không tìm thấy ô ${code}${floorName ? ` ở tầng ${floorName}` : ''}.`;
  if (matching.length > 1 && !floorName) {
    return `Có nhiều ô ${code}. Hãy nói thêm tầng: ${matching.map((slot) => slot.floorName).filter(Boolean).join(', ')}.`;
  }
  const slot = matching[0];
  const status = { available: 'đang trống', occupied: 'đang có xe đỗ', reserved: 'đã được đặt hoặc dành riêng', maintenance: 'đang bảo trì' }[slot.status]
    || 'chưa xác định trạng thái';
  return `Ô ${code}, ${slot.floorName || 'chưa xác định tầng'} ${status}.`;
}
