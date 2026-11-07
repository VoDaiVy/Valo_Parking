const maskLicensePlate = (licensePlate) => {
  const value = String(licensePlate || '');
  if (value.length <= 4) return value ? '***' : '';
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

const toPublicActiveSession = (session) => ({
  _id: session._id,
  parkingSlot: session.parkingSlot || null,
  floorId: session.floorId || null,
  vehicleType: session.vehicleType || null,
  checkInTime: session.checkInTime || null,
  expectedDurationHours: session.expectedDurationHours || null,
  status: session.status,
  licensePlate: session.licensePlate || null,
  phone: session.phone || session.userId?.phone || null,
  userId: session.userId || null,
});

const toKioskSession = (session) => ({
  _id: session._id,
  licensePlate: session.licensePlate,
  parkingSlot: session.parkingSlot || null,
  floorId: session.floorId || null,
  type: session.type || null,
  checkInTime: session.checkInTime || null,
  expectedDurationHours: session.expectedDurationHours || null,
  entryImage_url: session.entryImage_url || null,
  entryImage: session.entryImage || null,
  status: session.status,
});

module.exports = {
  maskLicensePlate,
  toPublicActiveSession,
  toKioskSession,
};
