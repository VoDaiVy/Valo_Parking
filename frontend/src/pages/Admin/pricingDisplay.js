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

export const getTimelineSegments = (timeBlocks) => {
  const colors = ['pricing-tone-0', 'pricing-tone-1', 'pricing-tone-2', 'pricing-tone-3', 'pricing-tone-4'];
  return timeBlocks.flatMap((block, index) => {
    const start = Number(block.startHour);
    const end = Number(block.endHour);
    const price = Number(block.price) || 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return [];

    const base = {
      id: `${index}-${start}-${end}`,
      label: `${formatHour(start)}-${formatHour(end)}`,
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
