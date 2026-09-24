const normalizePlate = (value) => String(value || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();
const documentId = (value) => String(value?._id || value || '');

export function getVipBookingSelection({ membership, vehicles = [], selectedVehicle, manualPlate, selectedSlot, startTime, endTime }) {
  const bookingStart = new Date(startTime);
  const bookingEnd = new Date(endTime);
  const expireAt = new Date(membership?.expireAt);
  const activeMembershipType = membership?.isVip
    && ['monthly', 'yearly'].includes(membership.packageType)
    && !Number.isNaN(bookingStart.getTime())
    && !Number.isNaN(expireAt.getTime())
    && expireAt > bookingStart
    ? membership.packageType : null;
  const plate = normalizePlate(selectedVehicle?.licensePlate || manualPlate);
  const isRegisteredPlate = Boolean(plate && vehicles.some((vehicle) =>
    vehicle.status === 'approved' && normalizePlate(vehicle.licensePlate) === plate));
  const selectedSlotIsOwnVipSlot = Boolean(activeMembershipType && isRegisteredPlate && selectedSlot
    && !Number.isNaN(bookingEnd.getTime()) && expireAt >= bookingEnd
    && membership?.reservedSlots?.some((slot) =>
      documentId(slot.floorId) === documentId(selectedSlot.floorId)
      && normalizeSlotCode(slot.slotNumber) === normalizeSlotCode(selectedSlot.slotCode)
      && (!slot.expireAt || new Date(slot.expireAt) >= bookingEnd)));

  return {
    activeMembershipType,
    isRegisteredPlate,
    selectedSlotIsOwnVipSlot,
    selectedRegisteredVehicleBlockedByVip: Boolean(activeMembershipType && isRegisteredPlate && selectedSlot && !selectedSlotIsOwnVipSlot),
  };
}
