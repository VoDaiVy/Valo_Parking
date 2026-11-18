const amount = value => {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  if (!['number', 'string'].includes(typeof value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export function bookingConfirmationSummary(info = {}) {
  const rows = Array.isArray(info?.bookings) ? info.bookings
    : info?.bookingId || info?._id ? [info] : [];
  const bookings = rows.filter(row => row && typeof row === 'object').map(row => ({
    ...row,
    bookingId: row.bookingId || row._id || '',
    slotCode: row.slotCode || row.parkingSlot || '',
    startTime: row.startTime || row.scheduledStart || '',
    endTime: row.endTime || row.scheduledEnd || '',
    totalAmount: [row.totalAmount, row.prepaidAmount, row.finalAmount].map(amount).find(value => value !== null) ?? null,
  }));
  // Confirmed server amounts take precedence over the old cart/quote. Zero is
  // valid (for example a fully discounted booking), never a missing value.
  const confirmedTotal = [info?.grandTotal, info?.transaction?.grandTotal,
    info?.finalAmount, info?.prepaidAmount, info?.totalAmount]
    .map(amount).find(value => value !== null);
  const completeItemAmounts = bookings.length > 0 && bookings.every(booking => booking.totalAmount !== null);
  return {
    bookings,
    total: confirmedTotal ?? (completeItemAmounts ? bookings.reduce((sum, booking) => sum + booking.totalAmount, 0) : null),
  };
}
