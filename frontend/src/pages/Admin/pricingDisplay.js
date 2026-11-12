const currencyFormatter = new Intl.NumberFormat('vi-VN');

export const formatCurrency = (value = 0) => `${currencyFormatter.format(Number(value) || 0)} VND`;

export const DEFAULT_DAY_NIGHT = {
  day: { isActive: false, startHour: 6, price: 50000 },
  night: { isActive: false, startHour: 18, price: 70000 },
};

export const serializeConfig = (timeBlocks, dayNightPricing, pricePolicies) => JSON.stringify({ timeBlocks, dayNightPricing, pricePolicies });

export const formatHour = (hour) => {
  const value = Number(hour) || 0;
  return value === 24 ? '24:00' : `${value.toString().padStart(2, '0')}:00`;
};

export const startHourOptions = Array.from({ length: 24 }).map((_, index) => ({
  value: index,
  label: formatHour(index),
}));

export const endHourOptions = Array.from({ length: 25 }).map((_, index) => ({
  value: index,
  label: index === 24 ? '24:00' : formatHour(index),
}));

export const numberNoSpinnerClass =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export const getDuration = (startHour, endHour) => {
  const start = Number(startHour);
  const end = Number(endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0;
  return start < end ? end - start : (24 - start) + end;
};

export const getRowError = (block) => {
  if (block.startHour < 0 || block.startHour > 23 || block.endHour < 0 || block.endHour > 24) {
    return 'Hours must be between 0 and 24.';
  }
  if (block.price === '' || block.price < 0) {
    return 'Price must be a valid number and cannot be negative.';
  }
  if (block.startHour === block.endHour) {
    return 'Start and end time cannot be identical.';
  }
  return '';
};

export const getScheduleStatus = (timeBlocks) => {
  if (!timeBlocks.length) {
    return {
      tone: 'warning',
      label: 'Schedule coverage incomplete.',
      detail: 'No time blocks configured.',
    };
  }

  const hours = new Array(24).fill(false);
  for (const block of timeBlocks) {
    const start = Number(block.startHour);
    const end = Number(block.endHour);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) continue;

    const markHour = (hour) => {
      if (hours[hour]) {
        throw new Error(`Overlap detected at ${formatHour(hour)}`);
      }
      hours[hour] = true;
    };

    try {
      if (start < end) {
        for (let hour = start; hour < end; hour++) markHour(hour);
      } else {
        for (let hour = start; hour < 24; hour++) markHour(hour);
        for (let hour = 0; hour < end; hour++) markHour(hour);
      }
    } catch (error) {
      return {
        tone: 'danger',
        label: 'Schedule coverage incomplete.',
        detail: error.message,
      };
    }
  }

  const missingHour = hours.findIndex((covered) => !covered);
  if (missingHour !== -1) {
    return {
      tone: 'warning',
      label: 'Schedule coverage incomplete.',
      detail: `Gap detected around ${formatHour(missingHour)}`,
    };
  }

  return {
    tone: 'success',
    label: 'Full 24-hour schedule covered.',
    detail: 'No gaps or overlaps detected.',
  };
};

// Schedule-only formatting: do not change form values or pricing calculations.
export const formatScheduleHour = (hour) => {
  if (hour === '' || hour == null || !Number.isFinite(Number(hour)) || Number(hour) < 0 || Number(hour) > 24) return 'Invalid time';
  const minutes = Math.round(Number(hour) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
export const formatSchedulePrice = (price, withUnit = true) => {
  if (price === '' || price == null || !Number.isFinite(Number(price)) || Number(price) < 0) return 'Invalid price';
  return `${currencyFormatter.format(Number(price))}${withUnit ? ' VND' : ''}`;
};
export const getTimelineWarning = (blocks) => {
  if (!blocks.length) return 'No time blocks configured.';
  if (blocks.some((b) => [b.startHour, b.endHour].some((v) => v === '' || v == null || !Number.isFinite(Number(v))) || Number(b.startHour) < 0 || Number(b.startHour) >= 24 || Number(b.endHour) < 0 || Number(b.endHour) > 24 || Number(b.startHour) === Number(b.endHour))) return 'Invalid time boundaries. Review the time blocks below.';
  if (blocks.some((b) => formatSchedulePrice(b.price) === 'Invalid price')) return 'Invalid or missing block fee. Review the time blocks below.';
  const ranges = getTimelineSegments(blocks).filter((s) => s.width > 0).sort((a, b) => a.left - b.left);
  let end = 0;
  let gap = false;
  for (const range of ranges) {
    if (range.left < end - 1e-8) return 'Overlapping time blocks. Review the time blocks below.';
    if (range.left > end + 1e-8) gap = true;
    end = range.left + range.width;
  }
  return gap || end < 100 - 1e-8 ? 'Schedule coverage incomplete. Unconfigured intervals remain empty.' : '';
};

export const getTimelineSegments = (timeBlocks) => {
  const colors = ['pricing-tone-0', 'pricing-tone-1', 'pricing-tone-2', 'pricing-tone-3', 'pricing-tone-4'];
  return timeBlocks.flatMap((block, index) => {
    const start = Number(block.startHour);
    const end = Number(block.endHour);
    const price = block.price;
    if (block.startHour === '' || block.startHour == null || block.endHour === '' || block.endHour == null || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= 24 || end < 0 || end > 24 || start === end) return [];

    const base = {
      id: `${index}-${start}-${end}`,
      label: `${formatScheduleHour(start)}\u2013${formatScheduleHour(end)}`,
      price,
      color: colors[index % colors.length],
      sourceIndex: index,
    };

    if (start < end) {
      return [{ ...base, left: (start / 24) * 100, width: ((end - start) / 24) * 100 }];
    }

    return [
      { ...base, id: `${base.id}-late`, left: (start / 24) * 100, width: ((24 - start) / 24) * 100 },
      { ...base, id: `${base.id}-early`, left: 0, width: (end / 24) * 100 },
    ];
  });
};
