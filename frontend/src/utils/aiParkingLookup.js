const fold = (value = '') => String(value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const compactPlate = (value = '') => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

export function detectDirectParkingLookup(message) {
  const text = fold(message);
  const hasScheduledTime = /\b(hom nay|toi nay|ngay mai|ngay kia|ngay\s+\d|mai|cuoi tuan|thu\s*[2-7]|chu nhat|today|tonight|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)
    || /\b\d{1,4}[/-]\d{1,2}\b|\b\d{1,2}\s*(?:h|:\d{2}|am|pm)\b/i.test(String(message))
    || /\b\d{1,2}\s+gio\b/.test(text);
  const plateMatch = text.match(/\b(\d{2})\s*([a-z]{1,2})\s*(\d{4,5})\b/i);
  const licensePlate = plateMatch ? compactPlate(`${plateMatch[1]}${plateMatch[2]}${plateMatch[3]}`) : '';
  const floorMatch = text.match(/\b(?:tang|floor)\s*([a-z]?\d+)\b/i);
  const floorName = floorMatch ? floorMatch[1].toUpperCase() : '';
  const slotMatch = text.match(/\b(?:o|slot)\s+(?:so\s+)?([a-z]{1,3})\s*(\d{1,5})\b/i)
    || (!licensePlate ? text.match(/^([a-z]{1,3})\s*(\d{1,4})\b/i) : null);
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

  const slotStatus = slotCode && /\b(trong|ban|co xe|co ai do|dang dung|dang duoc dung|bi chiem|trang thai|kiem tra|bao tri|da dat|giu cho|available|free|occupied|booked|reserved|maintenance|status)\b/.test(text);
  if (slotStatus && !hasScheduledTime) return { intent: 'CHECK_SLOT_STATUS', slotCode, floorName };

  const parkingAvailability = /\bcon\s+(?:bao nhieu\s+)?(?:cho|o)(?:\s+nao)?(?:\s+trong)?\b/.test(text)
    || /\bco\s+(?:cho|o)\s+trong\s+(?:khong|chua)\b/.test(text)
    || /\b(?:cho|o)\s+nao\s+trong\b/.test(text)
    || /\b(?:bai|ham|nha xe)\b.*\b(day|het cho|con cho|con trong|full|kin cho)\b/.test(text)
    || /\b(?:parking lot|car park|garage)\s+(?:full|available)\b|\b(?:any|how many)\s+(?:parking\s+)?(?:spaces?|slots?)\s+(?:available|free|left)\b/.test(text)
    || /\b(?:tang|floor)\s*[a-z]?\d+\b.*\b(con|co)\b.*\b(cho|o|trong)\b/.test(text)
    || /\b(?:zone|khu)\s+[a-z]\d*\b.*\b(con trong|con cho|het cho|kin cho|available|full)\b/.test(text)
    || /\b(?:cho|o)\s+trong\b.*\b(con|co|bao nhieu)\b/.test(text);
  if (parkingAvailability && !hasScheduledTime) {
    const zoneName = text.match(/\b(?:zone|khu)\s+([a-z]\d*|\d+)\b/)?.[1] || '';
    const electricCar = /\b(?:xe dien|o to dien|electric car|electric vehicle|ev)\b/.test(text);
    return { intent: 'CHECK_PARKING_AVAILABILITY', floorName, zoneName, electricCar };
  }

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
  const matching = bookings.filter((item) => compactPlate(item.licensePlate) === plate);
  const activeStatuses = new Set(['PENDING', 'PAID', 'ACTIVE', 'PAUSED']);
  const now = Date.now();
  const booking = matching
    .filter((item) => activeStatuses.has(String(item.status || '').toUpperCase())
      && new Date(item.scheduledEnd || item.endTime || 0).getTime() > now)
    .sort((a, b) => new Date(a.scheduledStart || a.startTime || 0) - new Date(b.scheduledStart || b.startTime || 0))[0]
    || matching.sort((a, b) => new Date(b.createdAt || b.scheduledStart || 0) - new Date(a.createdAt || a.scheduledStart || 0))[0];
  if (!booking) return `Xe ${plate} chưa có booking nào trong tài khoản của bạn.`;
  const isActive = activeStatuses.has(String(booking.status || '').toUpperCase())
    && new Date(booking.scheduledEnd || booking.endTime || 0).getTime() > now;
  const time = formatTime(booking.scheduledStart || booking.startTime);
  const slot = booking.parkingSlot || booking.slotCode;
  return `${isActive ? 'Booking đang hiệu lực' : 'Xe không có booking đang hiệu lực. Lịch sử gần nhất'} của xe ${plate} ${bookingState(booking.status)}${time ? `, bắt đầu ${time}` : ''}${slot ? `, ô ${slot}` : ''}.`;
}

export const getLiveParkingSlots = (response) => {
  const slots = normalizeList(response);
  if (!slots || !Array.isArray(response.data.data)) throw new Error(response?.data?.message || 'Không thể kiểm tra chỗ trống lúc này.');
  return slots.filter(slot => !slot.retired);
};

const sameFloor = (slot, requested) => {
  if (!requested) return true;
  const wanted = fold(requested).replace(/^(tang|floor)\s*/, '');
  const actual = fold(slot.floorName);
  const actualNumber = actual.match(/\b([a-z]?\d+)\b/)?.[1] || '';
  return actual === wanted || actual.replace(/^(tang|floor)\s*/, '') === wanted
    || actualNumber === wanted || String(slot.floorNumber ?? '') === wanted;
};

export function isLiveParkingSlotBookable(slot, electricCar = false) {
  const type = fold(slot.type || slot.slotType || 'standard');
  return !slot.retired && slot.acceptsBookings !== false
    && (slot.availabilityReason || slot.status) === 'available'
    && (['standard', 'hourly', 'slot'].includes(type) || (electricCar && ['ev', 'slot ev'].includes(type)));
}

export function parkingAvailabilityReply(response, floorName = '', { zoneName = '', electricCar = false, language = 'vi' } = {}) {
  const slots = getLiveParkingSlots(response);
  const en = language === 'en';
  const scope = [floorName && `${en ? 'Floor' : 'Tầng'} ${floorName}`, zoneName && `${en ? 'Zone' : 'Khu'} ${zoneName.toUpperCase()}`].filter(Boolean).join(' · ');
  const scoped = slots.filter(slot => sameFloor(slot, floorName)
    && (!zoneName || fold(slot.zone).replace(/^(zone|khu)\s+/, '') === fold(zoneName)));
  if (!scoped.length) return scope
    ? en ? `No parking spaces were found for ${scope}. Check the floor or zone name.` : `Không tìm thấy ô đỗ tại ${scope}. Bạn kiểm tra lại tầng hoặc khu nhé.`
    : en ? 'No parking space data is available yet.' : 'Bãi xe chưa có dữ liệu ô đỗ.';
  const isBookable = slot => isLiveParkingSlotBookable(slot, electricCar);
  const available = scoped.filter(isBookable);
  const suggestions = (available.length ? available : scope ? slots.filter(isBookable) : [])
    .slice(0, 3).map(slot => [slot.floorName, slot.id].filter(Boolean).join(' · ')).join(', ');
  if (!available.length) {
    const location = scope || (en ? 'The car park' : 'Bãi đỗ');
    const options = suggestions ? en ? ` Available elsewhere: ${suggestions}.` : ` Còn chỗ ở nơi khác: ${suggestions}.`
      : en ? ' Try another time.' : ' Bạn có thể thử khung giờ khác.';
    return en ? `${location} has no suitable spaces available right now.${options}` : `${location} hiện không còn chỗ phù hợp.${options}`;
  }
  return en
    ? `${available.length} suitable ${available.length === 1 ? 'space is' : 'spaces are'} available right now${scope ? ` in ${scope}` : ''}. ${suggestions}.`
    : `${scope || 'Toàn bãi'} hiện còn ${available.length} chỗ phù hợp. ${suggestions}.`;
}

export function slotStatusReply(response, slotCode, floorName = '', language = 'vi') {
  const code = String(slotCode || '').toUpperCase();
  const en = language === 'en';
  const matching = getLiveParkingSlots(response).filter((slot) => compactPlate(slot.id) === compactPlate(code) && sameFloor(slot, floorName));
  if (!matching.length) return en
    ? `Space ${code} was not found${floorName ? ` on floor ${floorName}` : ''}. Check the space code or floor.`
    : `Không tìm thấy ô ${code}${floorName ? ` ở tầng ${floorName}` : ''}. Bạn kiểm tra lại mã ô hoặc tầng nhé.`;
  if (matching.length > 1) {
    const floors = matching.map(slot => slot.floorName).filter(Boolean).join(', ');
    return en ? `Space code ${code} exists in more than one location. Which floor do you mean? ${floors}.`
      : `Có nhiều ô ${code}. Bạn muốn kiểm tra tầng nào? ${floors}.`;
  }
  const slot = matching[0];
  const statuses = {
    available: ['đang trống', 'is available'],
    occupied: ['đang có xe đỗ', 'is occupied'],
    reserved: ['đã được đặt hoặc dành riêng', 'is booked or reserved'],
    booked: ['đã có lượt đặt', 'has a booking'],
    held: ['đang được giữ tạm', 'is on a temporary hold'],
    dedicated: ['là ô dành riêng theo gói', 'is a dedicated space'],
    maintenance: ['đang bảo trì', 'is under maintenance'],
    closed: ['không mở đặt chỗ', 'is closed for bookings'],
  };
  const reason = slot.availabilityReason || (slot.status === 'available'
    ? slot.acceptsBookings === false ? 'closed' : slot.type === 'vip' ? 'dedicated' : 'available'
    : slot.status);
  const status = statuses[reason]?.[en ? 1 : 0] || (en ? 'has an unknown status' : 'chưa xác định trạng thái');
  return `${en ? 'Space' : 'Ô'} ${slot.id || code}${slot.floorName ? `, ${slot.floorName}` : ''} ${status}.`;
}
