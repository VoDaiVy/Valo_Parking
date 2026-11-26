export const normalizeSlotCodeLocal = (code) => String(code || '').replace(/[^A-Z0-9-]/gi, '').trim().toUpperCase();

export const formatFloorName = (name) => {
  if (!name) return 'Floor 1';
  const str = String(name).trim();
  return /^(floor|tầng)\b/i.test(str) ? str : `Floor ${str}`;
};

export const formatShortCurrency = (val) => {
  const num = Number(val);
  if (isNaN(num)) return '';
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}tr`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
  return `${num}`;
};

export const formatInputCurrency = (raw) => {
  if (raw === null || raw === undefined || raw === '') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  return new Intl.NumberFormat('vi-VN').format(Number(digits));
};

export const formatGateCurrency = (val) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(val || 0));

export const formatGateTime = (dateStr) =>
  dateStr ? new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';

export const getQuickCashSuggestions = (amount) => {
  const num = Number(amount);
  if (!num || num <= 0) return [];
  const suggestions = [];
  const next50k = Math.ceil(num / 50000) * 50000;
  if (next50k > num) suggestions.push(next50k);

  [100000, 200000, 500000].forEach((bill) => {
    if (bill > num && !suggestions.includes(bill)) {
      suggestions.push(bill);
    }
  });
  return suggestions.slice(0, 3);
};

export function classifyFloorSlot(
  slot,
  floorId,
  activeSessions,
  activeBookings,
  activeHolds,
  entryVerifyData,
  otherSelectedSlotKey = ''
) {
  const code = normalizeSlotCodeLocal(slot.slotNumber);
  const floorStr = String(floorId || '');
  const isVipSlot = Boolean(
    slot.subscriptionType || slot.subscriptionDetail || slot.slotType === 'vip' || slot.zoneID?.zoneType === 'vip'
  );
  const isEvSlot = slot.slotType === 'ev';
  const assignedCode = normalizeSlotCodeLocal(entryVerifyData?.assignedSlot);
  const isAssignedMatch = Boolean(
    assignedCode &&
    assignedCode === code &&
    (!entryVerifyData?.assignedFloorId || String(entryVerifyData.assignedFloorId) === floorStr)
  );

  const sessionMatch = activeSessions.find(
    (s) => String(s.floorId?._id || s.floorId || '') === floorStr && normalizeSlotCodeLocal(s.parkingSlot) === code
  );
  const bookingMatch = activeBookings.find(
    (b) => String(b.floorId?._id || b.floorId || '') === floorStr && normalizeSlotCodeLocal(b.parkingSlot) === code
  );
  const holdMatch = activeHolds.find(
    (h) => String(h.floorId?._id || h.floorId || '') === floorStr && normalizeSlotCodeLocal(h.slotCode) === code
  );

  const isPhysicallyOccupied = slot.status === 'occupied' || Boolean(slot.aiObservation?.occupied);
  const hasVipPassOwner = Boolean(slot.subscriptionType || slot.subscriptionDetail);
  const isSelectedByOtherLane = Boolean(otherSelectedSlotKey && otherSelectedSlotKey === `${floorStr}:${code}`);

  let state = 'available';
  let statusLabel = 'Available';
  let detail = slot.zoneID?.zoneName || (isVipSlot ? 'VIP Zone' : isEvSlot ? 'EV Zone' : 'Standard');
  let selectable = true;

  if (slot.status === 'maintenance') {
    state = 'maintenance';
    statusLabel = 'Maintenance';
    detail = 'Unavailable';
    selectable = false;
  } else if (sessionMatch || isPhysicallyOccupied) {
    state = 'occupied';
    statusLabel = 'Occupied';
    detail = sessionMatch?.licensePlate || slot.aiObservation?.detectedPlate || 'Vehicle inside';
    selectable = false;
  } else if (isSelectedByOtherLane) {
    state = 'held';
    statusLabel = 'Other Gate';
    detail = 'Selected on other entry lane';
    selectable = false;
  } else if (hasVipPassOwner && !isAssignedMatch) {
    state = 'vip_reserved';
    statusLabel = 'VIP Reserved';
    detail = slot.subscriptionDetail?.user?.username || 'Monthly Pass';
    selectable = false;
  } else if (bookingMatch && !isAssignedMatch) {
    state = 'booked';
    statusLabel = 'Booked';
    detail = bookingMatch.licensePlate || 'Pre-booked';
    selectable = false;
  } else if (holdMatch) {
    state = 'held';
    statusLabel = 'On Hold';
    detail = holdMatch.maskedPlate || 'Locked';
    selectable = false;
  } else if (isAssignedMatch) {
    state = 'assigned';
    statusLabel = entryVerifyData?.isMonthly ? 'VIP Match' : entryVerifyData?.isPausedResume ? 'Resumed Spot' : 'Booked Spot';
    detail = entryVerifyData?.isPausedResume ? 'Resumed session spot' : 'Assigned to vehicle';
    selectable = true;
  }

  return {
    id: slot._id || code,
    code,
    rawCode: slot.slotNumber,
    isVipSlot,
    isEvSlot,
    state,
    statusLabel,
    detail,
    selectable,
  };
}
