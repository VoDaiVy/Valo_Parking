const DEFAULT_CONFIG = {
  timeBlocks: [
    { startHour: 7, endHour: 12, price: 10000 },
    { startHour: 12, endHour: 17, price: 10000 },
    { startHour: 17, endHour: 22, price: 20000 },
    { startHour: 22, endHour: 7, price: 25000 }
  ],
  cap12h: 100000,
  cap24h: 180000
};

export const calculateBookingPrice = (startTime, endTime, options = {}) => {
  const config = options.config || DEFAULT_CONFIG;
  const blocks = config.timeBlocks || DEFAULT_CONFIG.timeBlocks;
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return {
      usageAmount: 0,
      totalAmount: 0,
      paidHours: 0,
      capApplied: false,
    };
  }

  const shiftMs = 7 * 60 * 60 * 1000;
  const startVn = new Date(start.getTime() + shiftMs);
  const endVn = new Date(end.getTime() + shiftMs);

  const startOfDay = new Date(startVn);
  startOfDay.setUTCHours(0, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);

  const endOfDay = new Date(endVn);
  endOfDay.setUTCHours(23, 59, 59, 999);

  let rawTotal = 0;

  for (let d = new Date(startOfDay); d <= endOfDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const date = d.getUTCDate();

    for (const block of blocks) {
      let blockStart = new Date(Date.UTC(year, month, date, block.startHour, 0, 0, 0));
      let blockEnd = new Date(Date.UTC(year, month, date, block.endHour, 0, 0, 0));

      if (block.endHour <= block.startHour) {
        blockEnd.setUTCDate(blockEnd.getUTCDate() + 1);
      }

      if (startVn < blockEnd && endVn > blockStart) {
        rawTotal += block.price;
      }
    }
  }

  const durationHours = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  let finalTotal = rawTotal;
  let capApplied = false;

  if (durationHours <= 12 && rawTotal > config.cap12h) {
    finalTotal = config.cap12h;
    capApplied = true;
  } else if (durationHours <= 24 && rawTotal > config.cap24h) {
    finalTotal = config.cap24h;
    capApplied = true;
  } else if (durationHours > 24) {
    const fullDays = Math.floor(durationHours / 24);
    const maxAllowed = fullDays * config.cap24h + config.cap24h;
    if (rawTotal > maxAllowed) {
      finalTotal = maxAllowed;
      capApplied = true;
    }
  }

  return {
    usageAmount: finalTotal,
    totalAmount: options.waiveOpeningFee ? 0 : finalTotal,
    durationMinutes: Math.ceil((end.getTime() - start.getTime()) / 60000),
    paidHours: durationHours,
    capApplied,
  };
};
