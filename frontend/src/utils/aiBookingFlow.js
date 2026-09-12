import { validDate, validTime } from './aiBookingValidation.js';

export const MAX_AI_BOOKING_DAYS = 5;
const activeStatus = new Set(['PAID', 'ACTIVE', 'PAUSED']);
const normalize = (value) => String(value || '').trim().toUpperCase();
const normalizePlate = (value) => normalize(value).replace(/[^A-Z0-9]/g, '');
const keyOf = (slot) => `${slot.floorId}:${normalize(slot.slotCode)}`;
const isCompatibleSlot = (slot, vehicleType) => {
  const type = normalize(slot.slotType);
  return type === 'SLOT' || (vehicleType === 'electric_car' && type === 'SLOT-EV');
};
const stableHash = (value) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
};
const chooseAutoSlot = (slots, seed, vehicleType) => {
  const preferredType = vehicleType === 'electric_car' ? 'SLOT-EV' : 'SLOT';
  const preferred = slots.filter((slot) => normalize(slot.slotType) === preferredType);
  const eligible = preferred.length ? preferred : slots.filter((slot) => normalize(slot.slotType) === 'SLOT');
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  return sorted[stableHash(seed) % sorted.length];
};
const floorMatches = (slot, requested) => {
  if (!requested) return true;
  const name = normalize(slot.floorName);
  const target = normalize(requested);
  const floorCode = (value) => value.replace(/^(?:TẦNG|FLOOR)\s*/u, '');
  if (name === target || floorCode(name) === floorCode(target)) return true;
  const code = floorCode(target);
  return /^\d+$/.test(code) && normalize(slot.floorNumber) === String(Number(code));
};
const parseDate = (date) => new Date(`${date}T12:00:00Z`);
const dayLabel = (date) => date.split('-').reverse().join('/');
const resultError = (result, fallback) => Object.assign(new Error(result?.data?.message || fallback), {
  responseData: result?.data, status: result?.status,
});

export function enumerateBookingDays(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
    throw new Error('Vui lòng chọn ngày đặt chỗ hợp lệ.');
  }
  const days = [];
  for (let current = parseDate(startDate); current <= parseDate(endDate); current.setUTCDate(current.getUTCDate() + 1)) {
    days.push(current.toISOString().slice(0, 10));
    if (days.length > MAX_AI_BOOKING_DAYS) {
      throw new Error('Đặt nhanh bằng AI hỗ trợ tối đa 5 ngày mỗi lần vì hệ thống chỉ giữ tối đa 5 chỗ.');
    }
  }
  return days;
}

export function getMissingBookingFields(draft, vehicles = []) {
  const missing = [];
  const approved = vehicles.filter((vehicle) => vehicle.status === 'approved'
    && (!draft.vehicleType || vehicle.vehicleType === draft.vehicleType));
  if (!draft.startDate) missing.push('Bạn muốn đỗ xe ngày nào?');
  if (!draft.startTime || !draft.endTime) missing.push('Bạn muốn đỗ từ mấy giờ đến mấy giờ?');
  if (!draft.licensePlate && !draft.vehicleId && approved.length !== 1) {
    missing.push(draft.vehicleType && !approved.length
      ? `Bạn chưa có xe ${draft.vehicleType === 'electric_car' ? 'điện' : 'ô tô'} đã duyệt. Hãy đăng ký xe trước khi đặt.`
      : 'Bạn muốn dùng xe nào? Hãy chọn xe hoặc cho biết biển số.');
  }
  return missing;
}

export function resolveBookingVehicle(draft, vehicles = []) {
  const approved = vehicles.filter((vehicle) => vehicle.status === 'approved');
  const eligible = approved.filter((vehicle) => !draft.vehicleType || vehicle.vehicleType === draft.vehicleType);
  const selected = eligible.find((vehicle) => String(vehicle._id) === String(draft.vehicleId))
    || eligible.find((vehicle) => normalize(vehicle.licensePlate) === normalize(draft.licensePlate))
    || (!draft.licensePlate && eligible.length === 1 ? eligible[0] : null);
  if (selected) return { vehicleId: selected._id, licensePlate: normalize(selected.licensePlate) };
  if (draft.vehicleType) throw new Error(`Vui lòng chọn xe ${draft.vehicleType === 'electric_car' ? 'điện' : 'ô tô'} đã được duyệt hoặc sửa lại loại xe trong yêu cầu.`);
  const manualPlate = normalize(draft.licensePlate).replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{4,12}$/.test(manualPlate)) return { licensePlate: manualPlate };
  throw new Error('Vui lòng chọn xe đã duyệt hoặc nhập biển số hợp lệ.');
}

export async function checkAiAvailability(draft, gateway, now = Date.now()) {
  if (!draft.startDate) return { missing: ['Bạn muốn kiểm tra ngày nào?'] };
  if (!draft.startTime || !draft.endTime) return { missing: ['Bạn muốn kiểm tra khoảng giờ nào?'] };
  const days = enumerateBookingDays(draft.startDate, draft.endDate || draft.startDate);
  if (!validTime(draft.startTime) || !validTime(draft.endTime) || draft.endTime <= draft.startTime) {
    throw new Error('Khoảng thời gian chưa hợp lệ.');
  }
  const results = [];
  for (const date of days) {
    const startTime = new Date(`${date}T${draft.startTime}:00+07:00`);
    const endTime = new Date(`${date}T${draft.endTime}:00+07:00`);
    if (startTime.getTime() <= now) throw new Error(`Giờ bắt đầu ngày ${dayLabel(date)} đã qua.`);
    const response = await gateway.getAvailableBookingSlots({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
    if (!response.ok) throw resultError(response, `Không thể kiểm tra ngày ${dayLabel(date)}.`);
    const matching = (response.data?.data?.slots || []).filter((slot) =>
      isCompatibleSlot(slot, draft.vehicleType || 'car')
      && floorMatches(slot, draft.floorName)
      && (!draft.slotCode || normalize(slot.slotCode) === normalize(draft.slotCode)));
    results.push({ date, count: matching.length, suggestions: matching.slice(0, 3) });
  }
  return { availability: results };
}

export async function findAiActionBookings(intent, draft, gateway) {
  const response = await gateway.getMyBookings();
  if (!response.ok) throw resultError(response, 'Không thể tải booking hiện tại.');
  let bookings = response.data?.data || [];
  if (intent === 'CANCEL_BOOKING') bookings = bookings.filter((item) => item.status === 'PAID');
  else if (intent !== 'VIEW_BOOKING') bookings = bookings.filter((item) => activeStatus.has(normalize(item.status)));
  if (draft.bookingId) bookings = bookings.filter((item) => String(item._id) === draft.bookingId);
  if (draft.licensePlate) bookings = bookings.filter((item) => normalize(item.licensePlate).replace(/[^A-Z0-9]/g, '') === normalize(draft.licensePlate).replace(/[^A-Z0-9]/g, ''));
  if (intent !== 'MODIFY_BOOKING' && draft.startDate) bookings = bookings.filter((item) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(item.scheduledStart || item.startTime)) === draft.startDate);
  return bookings;
}

export async function prepareAiExistingAction(intent, booking, gateway) {
  if (intent !== 'CANCEL_BOOKING') return {};
  const response = await gateway.getBookingCancellationQuote(booking._id);
  if (!response.ok) throw resultError(response, 'Không thể tính tiền hoàn khi hủy.');
  return response.data?.data || {};
}

export async function confirmAiExistingAction(intent, booking, edit, gateway) {
  let response;
  if (intent === 'CANCEL_BOOKING') {
    response = await gateway.cancelBooking(booking._id);
  } else if (intent === 'MODIFY_BOOKING') {
    if (!validDate(edit?.startDate) || !validDate(edit?.endDate) || !validTime(edit?.startTime) || !validTime(edit?.endTime)) {
      throw new Error('Thời gian sửa booking chưa hợp lệ.');
    }
    const start = new Date(`${edit.startDate}T${edit.startTime}:00+07:00`);
    const end = new Date(`${edit.endDate}T${edit.endTime}:00+07:00`);
    if (start >= end) throw new Error('Thời gian sửa booking chưa hợp lệ.');
    response = await gateway.extendBooking(booking._id, { newStart: start.toISOString(), newEnd: end.toISOString() });
  } else {
    throw new Error('Thao tác booking không hợp lệ.');
  }
  if (!response.ok) throw resultError(response, 'Không thể cập nhật booking.');
  return response.data?.data || {};
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export async function prepareAiBooking(draft, gateway, vehicles, now = Date.now()) {
  const missing = getMissingBookingFields(draft, vehicles);
  if (missing.length) return { missing };
  const days = enumerateBookingDays(draft.startDate, draft.endDate || draft.startDate);
  if (!validTime(draft.startTime) || !validTime(draft.endTime) || draft.endTime <= draft.startTime) {
    throw new Error('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
  }
  const durationMinutes = (Number(draft.endTime.slice(0, 2)) * 60 + Number(draft.endTime.slice(3)))
    - (Number(draft.startTime.slice(0, 2)) * 60 + Number(draft.startTime.slice(3)));
  if (durationMinutes < 30) throw new Error('Thời gian đặt tối thiểu là 30 phút.');
  const vehicle = resolveBookingVehicle(draft, vehicles);
  const selectedVehicle = vehicles.find((item) => String(item._id) === String(vehicle.vehicleId)
    || normalize(item.licensePlate) === normalize(vehicle.licensePlate));
  const vehicleType = draft.vehicleType || selectedVehicle?.vehicleType || 'car';
  const bookingResult = await gateway.getMyBookings();
  if (!bookingResult.ok) throw resultError(bookingResult, 'Không thể kiểm tra booking hiện tại.');
  const existing = bookingResult.data?.data || [];
  const candidates = [];
  const conflicts = [];

  for (const date of days) {
    const startTime = new Date(`${date}T${draft.startTime}:00+07:00`);
    const endTime = new Date(`${date}T${draft.endTime}:00+07:00`);
    if (startTime.getTime() <= now) throw new Error(`Ngày ${dayLabel(date)} đã qua hoặc giờ bắt đầu không còn hợp lệ.`);
    const ownOverlap = existing.find((booking) => activeStatus.has(normalize(booking.status))
      && ((vehicle.vehicleId && booking.vehicleId && String(booking.vehicleId?._id || booking.vehicleId) === String(vehicle.vehicleId))
        || normalizePlate(booking.licensePlate) === normalizePlate(vehicle.licensePlate))
      && rangesOverlap(startTime, endTime, new Date(booking.scheduledStart || booking.startTime), new Date(booking.scheduledEnd || booking.endTime)));
    if (ownOverlap) {
      conflicts.push(`${dayLabel(date)}: xe ${vehicle.licensePlate} đã có booking trùng thời gian. Hãy chọn khung giờ khác.`);
      continue;
    }
    const availability = await gateway.getAvailableBookingSlots({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
    if (!availability.ok) throw resultError(availability, `Không thể kiểm tra chỗ ngày ${dayLabel(date)}.`);
    const allSlots = (availability.data?.data?.slots || []).filter((slot) => isCompatibleSlot(slot, vehicleType));
    const preferredFloor = normalize(draft.floorName);
    const preferredSlot = normalize(draft.slotCode);
    const floorSlots = preferredFloor ? allSlots.filter((slot) => floorMatches(slot, preferredFloor)) : allSlots;
    const exact = preferredSlot ? floorSlots.find((slot) => normalize(slot.slotCode) === preferredSlot) : null;
    const seed = `${vehicle.licensePlate}:${date}:${draft.startTime}:${draft.endTime}`;
    const chosen = exact || (!preferredSlot ? chooseAutoSlot(floorSlots, seed, vehicleType) : null);
    if (!chosen) {
      const suggestion = chooseAutoSlot(floorSlots, seed, vehicleType) || chooseAutoSlot(allSlots, seed, vehicleType);
      conflicts.push(`${dayLabel(date)}: ${preferredSlot ? `ô ${preferredSlot}` : 'không có ô phù hợp'} không còn trống hoặc không phù hợp với loại xe.${suggestion ? ` Gợi ý: ${suggestion.floorName} · ${suggestion.slotCode}.` : ' Hãy chọn giờ hoặc tầng khác.'}`);
      continue;
    }
    candidates.push({ date, startTime: startTime.toISOString(), endTime: endTime.toISOString(), slot: chosen, availableSlots: floorSlots });
  }
  if (conflicts.length) return { conflicts, days };

  // Keep the same slot across days when possible, while allowing a per-day alternative.
  if (!draft.slotCode && candidates.length > 1) {
    const first = candidates[0].availableSlots;
    const commonSlots = first.filter((slot) => candidates.every((day) => day.availableSlots.some((candidate) => keyOf(candidate) === keyOf(slot))));
    const common = chooseAutoSlot(commonSlots, `${vehicle.licensePlate}:${draft.startDate}:${draft.endDate}:${draft.startTime}:${draft.endTime}`, vehicleType);
    if (common) candidates.forEach((day) => { day.slot = common; });
  }
  const items = candidates.map((candidate, index) => ({
    clientItemId: `ai-${index}-${candidate.date}`,
    ...vehicle,
    floorId: candidate.slot.floorId,
    slotCode: candidate.slot.slotCode,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    serviceIds: [],
    date: candidate.date,
    floorName: candidate.slot.floorName,
  }));
  const quote = await gateway.quoteBulkBooking({ items });
  if (!quote.ok) throw resultError(quote, 'Không thể tính giá booking.');
  const itemErrors = quote.data?.data?.itemErrors || [];
  if (itemErrors.length) return { conflicts: itemErrors.map((error) => error.message), days };
  if ((quote.data?.data?.items || []).length !== items.length) throw new Error('Báo giá chưa đầy đủ cho tất cả các ngày.');
  const wallet = await gateway.getWalletInfo();
  if (!wallet.ok) throw resultError(wallet, 'Không thể kiểm tra số dư ví.');
  const total = Number(quote.data.data.grandTotal);
  if (!Number.isFinite(total) || total < 0) throw new Error('Báo giá không hợp lệ.');
  return { items, days, durationMinutes, total, walletBalance: Number(wallet.data?.data?.balance || 0), quotes: quote.data.data.items };
}

export async function confirmAiBooking(preview, draft, gateway, vehicles, idempotencyKey) {
  const fresh = await prepareAiBooking(draft, gateway, vehicles);
  if (fresh.missing || fresh.conflicts) return { refreshed: fresh };
  const same = fresh.total === preview.total && JSON.stringify(fresh.items) === JSON.stringify(preview.items);
  if (!same) return { refreshed: fresh };
  if (fresh.walletBalance < fresh.total) throw new Error(`Số dư ví chưa đủ. Cần thêm ${(fresh.total - fresh.walletBalance).toLocaleString('vi-VN')} VND.`);
  const holds = [];
  try {
    for (const item of fresh.items) {
      const held = await gateway.createBookingHold(item);
      if (!held.ok || !held.data?.data?._id) throw resultError(held, `Không thể giữ ô ${item.slotCode} ngày ${dayLabel(item.date)}.`);
      holds.push(held.data.data._id);
    }
    const result = await gateway.createBulkBooking({
      idempotencyKey,
      items: fresh.items.map((item, index) => ({ ...item, holdId: holds[index] })),
    });
    if (!result.ok) throw resultError(result, 'Không thể tạo booking.');
    return { success: result.data?.data };
  } catch (error) {
    if (error.status === 0) {
      const current = await gateway.getMyBookings();
      if (current.ok) {
        const bookings = current.data?.data || [];
        const allCreated = fresh.items.every((item) => bookings.some((booking) =>
          activeStatus.has(normalize(booking.status))
          && normalize(booking.licensePlate) === normalize(item.licensePlate)
          && String(booking.floorId?._id || booking.floorId) === String(item.floorId)
          && normalize(booking.parkingSlot) === normalize(item.slotCode)
          && new Date(booking.scheduledStart).toISOString() === item.startTime
          && new Date(booking.scheduledEnd).toISOString() === item.endTime));
        if (allCreated) return { success: { bookings, reconciled: true } };
      }
    }
    await Promise.allSettled(holds.map((holdId) => gateway.releaseBookingHold(holdId)));
    throw error;
  }
}
