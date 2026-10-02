import { validDate, validTime } from './aiBookingValidation.js';
import { isValidLicensePlate, normalizeLicensePlate } from './licensePlate.js';
import { localizeAiBookingMessage } from './aiBookingMessages.js';

export const MAX_AI_BOOKING_ITEMS = 5;
const activeStatus = new Set(['PAID', 'ACTIVE', 'PAUSED']);
const normalize = (value) => String(value || '').trim().toUpperCase();
const normalizePlate = normalizeLicensePlate;
const suppliedDraftPlates = (draft) => [...new Set([
  ...(Array.isArray(draft?.licensePlates) ? draft.licensePlates : []),
  ...(Array.isArray(draft?.reservationItems) ? draft.reservationItems.map((item) => item?.licensePlate) : []),
  draft?.licensePlate,
].map(normalizePlate).filter(Boolean))];
const draftPlates = (draft) => suppliedDraftPlates(draft).filter(isValidLicensePlate);
const draftReservationItems = (draft) => (Array.isArray(draft?.reservationItems)
  ? draft.reservationItems.filter((item) => item && typeof item === 'object').slice(0, MAX_AI_BOOKING_ITEMS)
  : []);
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
const dayLabel = (date) => date.split('-').reverse().join('/');
const rangeLabel = (request) => `${dayLabel(request.date)} ${request.startTime} đến ${dayLabel(request.endDate)} ${request.endTime}`;
const vietnamDate = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(now));
const resultError = (result, fallback) => Object.assign(new Error(localizeAiBookingMessage(result?.data?.message || fallback)), {
  responseData: result?.data, status: result?.status,
});

export const isVipBookingRestriction = (error) => {
  if (error?.code === 'VIP_BOOKING_RESTRICTED') return true;
  const message = String(error?.message || '');
  return /already in a VIP subscription|please use your VIP parking slot instead of making a new booking|đang có gói VIP|thuộc xe VIP của tài khoản khác/i.test(message);
};

export function bookingDateSchedules(draft = {}) {
  return [{
    date: draft.startDate || '',
    endDate: draft.endDate || draft.startDate || '',
    startTime: draft.startTime || '',
    endTime: draft.endTime || '',
    bookingMode: 'CONTINUOUS',
  }];
}

export function getMissingBookingFields(draft, vehicles = [], now = Date.now()) {
  const missing = [];
  const suppliedPlates = suppliedDraftPlates(draft);
  const plates = draftPlates(draft);
  const invalidPlates = suppliedPlates.filter((plate) => !isValidLicensePlate(plate));
  const requestedCount = Number(draft.requestedVehicleCount || 0);
  const reservationItems = draftReservationItems(draft);
  const approved = vehicles.filter((vehicle) => vehicle.status === 'approved'
    && (!draft.vehicleType || vehicle.vehicleType === draft.vehicleType));
  const today = vietnamDate(now);
  const schedules = reservationItems.length ? reservationItems.map((item, index) => ({
    label: `Xe ${index + 1}: `,
    date: item.startDate || draft.startDate,
    time: item.startTime || draft.startTime,
  })) : [{ label: '', date: draft.startDate, time: draft.startTime }];
  const elapsed = schedules.find(({ date, time }) => (
    validDate(date) && (date < today || (date === today && validTime(time)
      && new Date(`${date}T${time}:00+07:00`).getTime() <= now))
  ));
  if (elapsed) {
    return [`${elapsed.label}${elapsed.time && elapsed.date === today ? `giờ ${elapsed.time} hôm nay` : `ngày ${dayLabel(elapsed.date)}`} đã qua. Vui lòng chọn thời gian trong tương lai.`];
  }
  if (reservationItems.length) {
    const count = requestedCount || reservationItems.length;
    for (let index = 0; index < count; index += 1) {
      const item = reservationItems[index] || {};
      if (!(item.startDate || draft.startDate)) missing.push(`Xe ${index + 1} đỗ ngày nào?`);
      else if (!(item.startTime || draft.startTime)) missing.push(`Xe ${index + 1} bắt đầu đỗ lúc mấy giờ?`);
      else if (!(item.endTime || draft.endTime)) missing.push(`Xe ${index + 1} muốn đỗ đến mấy giờ?`);
    }
  } else {
    if (!draft.startDate) missing.push('Bạn muốn bắt đầu đỗ ngày nào?');
    else if (!draft.endDate) missing.push('Bạn muốn kết thúc đỗ ngày nào?');
    if (!draft.startTime) missing.push(`Bạn muốn bắt đầu lúc mấy giờ${draft.startDate ? ` ngày ${dayLabel(draft.startDate)}` : ''}?`);
    else if (!draft.endTime) missing.push(`Bạn muốn kết thúc lúc mấy giờ${draft.endDate ? ` ngày ${dayLabel(draft.endDate)}` : ''}?`);
  }
  if (invalidPlates.length) {
    missing.push(`Biển số ${invalidPlates.join(', ')} không hợp lệ. Hãy dùng biển ô tô gồm 2 số tỉnh, 1 đến 2 chữ cái và 4 đến 5 số cuối, ví dụ 43A12345.`);
  } else if (draft.blockedVipPlate && (!plates.length || plates.includes(normalizePlate(draft.blockedVipPlate)))) {
    missing.push(`Xe ${draft.blockedVipPlate} đang có gói VIP. Vui lòng đọc hoặc nhập biển số xe khác để đặt chỗ theo giờ.`);
  } else if (requestedCount > plates.length) {
    missing.push(`Bạn muốn đặt ${requestedCount} xe. Vui lòng cung cấp thêm ${requestedCount - plates.length} biển số xe.`);
  } else if (!plates.length && !draft.vehicleId && approved.length !== 1) {
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
    || eligible.find((vehicle) => normalizePlate(vehicle.licensePlate) === normalizePlate(draft.licensePlate))
    || (!draft.licensePlate && eligible.length === 1 ? eligible[0] : null);
  if (selected) {
    const selectedPlate = normalizePlate(selected.licensePlate);
    if (!isValidLicensePlate(selectedPlate)) throw new Error(`Biển số ${selectedPlate} của xe đã đăng ký không hợp lệ. Vui lòng cập nhật lại thông tin xe.`);
    return { vehicleId: selected._id, licensePlate: selectedPlate };
  }
  if (draft.vehicleType) throw new Error(`Vui lòng chọn xe ${draft.vehicleType === 'electric_car' ? 'điện' : 'ô tô'} đã được duyệt hoặc sửa lại loại xe trong yêu cầu.`);
  const manualPlate = normalizePlate(draft.licensePlate);
  if (isValidLicensePlate(manualPlate)) return { licensePlate: manualPlate };
  throw new Error('Vui lòng chọn xe đã duyệt hoặc nhập biển ô tô hợp lệ, ví dụ 43A12345.');
}

export function resolveBookingVehicles(draft, vehicles = []) {
  const plates = draftPlates(draft);
  if (!plates.length) return [resolveBookingVehicle(draft, vehicles)];
  return plates.map((licensePlate) => resolveBookingVehicle({ ...draft, vehicleId: '', licensePlate }, vehicles));
}

export async function checkAiAvailability(draft, gateway, now = Date.now()) {
  const missing = getMissingBookingFields({ ...draft, licensePlate: '43A12345' }, [{
    _id: 'availability-only', licensePlate: '43A12345', status: 'approved', vehicleType: draft.vehicleType || 'car',
  }], now).filter((message) => !/xe nào|biển số/i.test(message));
  if (missing.length) return { missing };
  const schedules = bookingDateSchedules(draft);
  const results = [];
  for (const schedule of schedules) {
    if (!validDate(schedule.date) || !validDate(schedule.endDate)
      || !validTime(schedule.startTime) || !validTime(schedule.endTime)) {
      throw new Error('Khoảng thời gian chưa hợp lệ.');
    }
    const startTime = new Date(`${schedule.date}T${schedule.startTime}:00+07:00`);
    const endTime = new Date(`${schedule.endDate}T${schedule.endTime}:00+07:00`);
    if (endTime <= startTime) throw new Error('Khoảng thời gian chưa hợp lệ.');
    if (startTime.getTime() <= now) throw new Error(`Giờ bắt đầu ngày ${dayLabel(schedule.date)} đã qua.`);
    const response = await gateway.getAvailableBookingSlots({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
    if (!response.ok) throw resultError(response, `Không thể kiểm tra khoảng từ ngày ${dayLabel(schedule.date)} đến ${dayLabel(schedule.endDate)}.`);
    const matching = (response.data?.data?.slots || []).filter((slot) =>
      isCompatibleSlot(slot, draft.vehicleType || 'car')
      && floorMatches(slot, draft.floorName)
      && (!draft.slotCode || normalize(slot.slotCode) === normalize(draft.slotCode)));
    results.push({ date: schedule.date, endDate: schedule.endDate, bookingMode: schedule.bookingMode,
      count: matching.length, suggestions: matching.slice(0, 3) });
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
  const explicitItems = draftReservationItems(draft);
  const requestedCount = Number(draft.requestedVehicleCount || 0);
  const bookingVehicles = explicitItems.length ? [] : resolveBookingVehicles(draft, vehicles);
  const requestSpecs = [];
  if (explicitItems.length) {
    const count = requestedCount || explicitItems.length;
    for (let index = 0; index < count; index += 1) {
      const source = explicitItems[index] || {};
      const vehicle = resolveBookingVehicle({
        ...draft,
        vehicleId: source.vehicleId || '',
        licensePlate: source.licensePlate || draftPlates(draft)[index] || '',
      }, vehicles);
      const startDate = source.startDate || draft.startDate;
      const endDate = source.endDate || draft.endDate || startDate;
      requestSpecs.push({
        sourceIndex: index, vehicle, date: startDate, endDate, bookingMode: 'CONTINUOUS',
        startTime: source.startTime || draft.startTime,
        endTime: source.endTime || draft.endTime,
        floorName: source.floorName || draft.floorName || '',
        zoneName: source.zoneName || draft.zoneName || '',
        slotCode: source.slotCode || draft.slotCode || '',
      });
    }
  } else {
    for (const vehicle of bookingVehicles) {
      requestSpecs.push({
        sourceIndex: requestSpecs.length, vehicle,
        date: draft.startDate, endDate: draft.endDate || draft.startDate,
        bookingMode: 'CONTINUOUS',
        startTime: draft.startTime, endTime: draft.endTime,
        floorName: draft.floorName || '', zoneName: draft.zoneName || '', slotCode: draft.slotCode || '',
      });
    }
  }
  if (requestSpecs.length > MAX_AI_BOOKING_ITEMS) {
    throw new Error(`Mỗi lần xác nhận tối đa ${MAX_AI_BOOKING_ITEMS} chỗ. Vui lòng giảm số xe rồi thử lại.`);
  }
  const days = [...new Set(requestSpecs.map((request) => request.date))].sort();
  for (const request of requestSpecs) {
    if (!validDate(request.date) || !validDate(request.endDate)
      || !validTime(request.startTime) || !validTime(request.endTime)) {
      throw new Error(`Thời gian của xe ${request.vehicle.licensePlate} chưa hợp lệ.`);
    }
    const start = new Date(`${request.date}T${request.startTime}:00+07:00`);
    const end = new Date(`${request.endDate}T${request.endTime}:00+07:00`);
    const durationMinutes = (end.getTime() - start.getTime()) / 60000;
    if (end <= start) throw new Error(`Giờ kết thúc của xe ${request.vehicle.licensePlate} phải sau giờ bắt đầu.`);
    if (durationMinutes < 30) throw new Error(`Xe ${request.vehicle.licensePlate} cần đặt tối thiểu 30 phút.`);
  }
  if (!explicitItems.length && bookingVehicles.length > 1 && draft.slotCode) {
    return { conflicts: ['Không thể dùng cùng một ô cho nhiều xe. Vui lòng để trống ô đỗ để hệ thống xếp một ô riêng cho mỗi xe.'], days };
  }
  const bookingResult = await gateway.getMyBookings();
  if (!bookingResult.ok) throw resultError(bookingResult, 'Không thể kiểm tra booking hiện tại.');
  const existing = bookingResult.data?.data || [];
  const candidates = [];
  const conflicts = [];
  const availabilityCache = new Map();
  const shortageRanges = new Set();

  for (const request of requestSpecs) {
    const startTime = new Date(`${request.date}T${request.startTime}:00+07:00`);
    const endTime = new Date(`${request.endDate}T${request.endTime}:00+07:00`);
    if (startTime.getTime() <= now) throw new Error(`Ngày ${dayLabel(request.date)} đã qua hoặc giờ bắt đầu không còn hợp lệ.`);
    const rangeKey = `${startTime.toISOString()}|${endTime.toISOString()}`;
    if (!availabilityCache.has(rangeKey)) {
      const response = await gateway.getAvailableBookingSlots({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
      if (!response.ok) throw resultError(response, `Không thể kiểm tra chỗ ngày ${dayLabel(request.date)}.`);
      availabilityCache.set(rangeKey, response.data?.data?.slots || []);
    }
    const vehicle = request.vehicle;
    const selectedVehicle = vehicles.find((item) => String(item._id) === String(vehicle.vehicleId)
      || normalizePlate(item.licensePlate) === normalizePlate(vehicle.licensePlate));
    const vehicleType = draft.vehicleType || selectedVehicle?.vehicleType || 'car';
    const ownOverlap = existing.find((booking) => activeStatus.has(normalize(booking.status))
      && ((vehicle.vehicleId && booking.vehicleId && String(booking.vehicleId?._id || booking.vehicleId) === String(vehicle.vehicleId))
        || normalizePlate(booking.licensePlate) === normalizePlate(vehicle.licensePlate))
      && rangesOverlap(startTime, endTime, new Date(booking.scheduledStart || booking.startTime), new Date(booking.scheduledEnd || booking.endTime)));
    const requestedOverlap = candidates.find((candidate) => normalizePlate(candidate.vehicle.licensePlate) === normalizePlate(vehicle.licensePlate)
      && rangesOverlap(startTime, endTime, new Date(candidate.startTime), new Date(candidate.endTime)));
    if (ownOverlap || requestedOverlap) {
      conflicts.push(`Xe ${vehicle.licensePlate} đã có booking trùng thời gian trong khoảng ${rangeLabel(request)}. Hãy chọn khoảng thời gian khác.`);
      continue;
    }
    const occupiedSlots = new Set(candidates.filter((candidate) =>
      rangesOverlap(startTime, endTime, new Date(candidate.startTime), new Date(candidate.endTime)))
      .map((candidate) => keyOf(candidate.slot)));
    const allCompatibleSlots = availabilityCache.get(rangeKey).filter((slot) => isCompatibleSlot(slot, vehicleType));
    const compatibleSlots = allCompatibleSlots.filter((slot) => !occupiedSlots.has(keyOf(slot)));
    const preferredFloor = normalize(request.floorName);
    const preferredZone = normalize(request.zoneName);
    const preferredSlot = normalize(request.slotCode);
    const matchingZoneSlots = preferredZone ? compatibleSlots.filter((slot) => (
      normalize(slot.zoneName) === preferredZone
      || normalize(slot.zoneName).replace(/^ZONE\s+/, '') === preferredZone.replace(/^ZONE\s+/, '')
    )) : [];
    const zoneSlots = preferredZone
      ? (matchingZoneSlots.length
        ? matchingZoneSlots
        : compatibleSlots.filter((slot) => normalize(slot.slotCode) === preferredZone))
      : compatibleSlots;
    const floorSlots = preferredFloor ? zoneSlots.filter((slot) => floorMatches(slot, preferredFloor)) : zoneSlots;
    const exact = preferredSlot ? floorSlots.find((slot) => normalize(slot.slotCode) === preferredSlot) : null;
    const seed = `${vehicle.licensePlate}:${request.date}:${request.startTime}:${request.endTime}`;
    const chosen = exact || (!preferredSlot ? chooseAutoSlot(floorSlots, seed, vehicleType) : null);
    if (!chosen) {
      const sameRangeRequests = requestSpecs.filter((item) => item.date === request.date && item.endDate === request.endDate
        && item.startTime === request.startTime && item.endTime === request.endTime);
      if (!preferredSlot && sameRangeRequests.length > 1
        && sameRangeRequests.length > allCompatibleSlots.length && !shortageRanges.has(rangeKey)) {
        shortageRanges.add(rangeKey);
        conflicts.push(`Hiện chỉ còn ${allCompatibleSlots.length} chỗ trống trong toàn bộ khoảng ${rangeLabel(request)}, nên chưa thể đặt đủ ${sameRangeRequests.length} xe. Bạn muốn giảm số xe hay chọn thời gian khác?`);
      } else if (!shortageRanges.has(rangeKey)) {
        const suggestion = chooseAutoSlot(floorSlots, seed, vehicleType) || chooseAutoSlot(compatibleSlots, seed, vehicleType);
        conflicts.push(`Không có chỗ phù hợp cho toàn bộ khoảng ${rangeLabel(request)}. Xe ${vehicle.licensePlate} ${preferredSlot
          ? `không thể dùng ô ${preferredSlot} vì ô không còn trống hoặc không phù hợp với loại xe`
          : preferredZone
            ? `không còn ô phù hợp tại khu ${request.zoneName}`
            : 'không có ô phù hợp hoặc không còn trống'}.${suggestion ? ` Gợi ý: ${suggestion.floorName} · ${suggestion.slotCode}.` : ' Hãy chọn giờ, khu hoặc tầng khác.'}`);
      }
      continue;
    }
    candidates.push({
      ...request, vehicle, vehicleType,
      startTime: startTime.toISOString(), endTime: endTime.toISOString(),
      slot: chosen, availableSlots: floorSlots,
    });
  }
  if (conflicts.length || candidates.length !== requestSpecs.length) return { conflicts, days };

  const items = candidates.map((candidate, index) => ({
    clientItemId: `ai-${index}-${candidate.date}-${candidate.vehicle.licensePlate}`,
    ...candidate.vehicle,
    floorId: candidate.slot.floorId,
    slotCode: candidate.slot.slotCode,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    serviceIds: Array.isArray(draft.serviceIds) ? draft.serviceIds : [],
    date: candidate.date,
    endDate: candidate.endDate,
    bookingMode: candidate.bookingMode,
    floorName: candidate.slot.floorName,
  }));
  const quote = await gateway.quoteBulkBooking({ items });
  const itemErrors = quote.data?.data?.itemErrors || [];
  const vipError = itemErrors.find(isVipBookingRestriction);
  if (vipError) {
    const vipItem = items.find((item) => item.clientItemId === vipError.clientItemId);
    const messagePlate = String(vipError.message || '').match(/(?:Vehicle|Xe|Biển số)\s+([A-Z0-9.-]{4,15})/i)?.[1];
    return { vipPlateRequired: normalizePlate(vipItem?.licensePlate || messagePlate || bookingVehicles[0].licensePlate), days };
  }
  if (!quote.ok) {
    if (isVipBookingRestriction(quote.data)) {
      const messagePlate = String(quote.data?.message || '').match(/(?:Vehicle|Xe|Biển số)\s+([A-Z0-9.-]{4,15})/i)?.[1];
      return { vipPlateRequired: normalizePlate(messagePlate || bookingVehicles[0].licensePlate), days };
    }
    throw resultError(quote, 'Không thể tính giá booking.');
  }
  if (itemErrors.length) return { conflicts: itemErrors.map((error) => localizeAiBookingMessage(error.message)), days };
  if ((quote.data?.data?.items || []).length !== items.length) throw new Error('Báo giá chưa đầy đủ cho tất cả chỗ.');
  const wallet = await gateway.getWalletInfo();
  if (!wallet.ok) throw resultError(wallet, 'Không thể kiểm tra số dư ví.');
  const total = Number(quote.data.data.grandTotal);
  if (!Number.isFinite(total) || total < 0) throw new Error('Báo giá không hợp lệ.');
  const durations = requestSpecs.map((request) => (
    new Date(`${request.endDate}T${request.endTime}:00+07:00`).getTime()
      - new Date(`${request.date}T${request.startTime}:00+07:00`).getTime()
  ) / 60000);
  const durationMinutes = durations.every((duration) => duration === durations[0]) ? durations[0] : null;
  return { items, days, bookingMode: 'CONTINUOUS',
    durationMinutes, total, walletBalance: Number(wallet.data?.data?.balance || 0), quotes: quote.data.data.items };
}

export async function confirmAiBooking(preview, draft, gateway, vehicles, idempotencyKey) {
  const fresh = await prepareAiBooking(draft, gateway, vehicles);
  if (fresh.missing || fresh.conflicts || fresh.vipPlateRequired) return { refreshed: fresh };
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
