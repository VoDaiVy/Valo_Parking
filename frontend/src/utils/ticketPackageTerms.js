export const defaultPackageDuration = (type) => ({
  hourly: { value: 1, unit: 'hours' }, daily: { value: 24, unit: 'hours' },
  monthly: { value: 720, unit: 'hours' }, yearly: { value: 12, unit: 'calendarMonths' },
}[type] || { value: 1, unit: 'hours' });

export const packageDurationLabel = (pkg) => {
  const duration = pkg?.duration?.value ? pkg.duration : defaultPackageDuration(typeof pkg === 'string' ? pkg : pkg?.type);
  const unit = ['calendarMonths', 'months'].includes(duration.unit) ? 'calendar months' : duration.unit;
  return `${duration.value} ${unit}`;
};

export const packageSalesAvailability = (pkg, now = Date.now()) => {
  if (pkg?.isActive === false) return { available: false, message: 'This package is inactive.' };
  if (pkg?.salesStartAt && new Date(pkg.salesStartAt).getTime() > now) return { available: false, message: 'Sales have not started yet.' };
  if (pkg?.salesEndAt && new Date(pkg.salesEndAt).getTime() <= now) return { available: false, message: 'Sales have ended. Existing benefits remain valid.' };
  return (pkg?.salesStartAt || pkg?.salesEndAt ? null : pkg?.salesAvailability) || { available: true, message: 'Available for purchase.' };
};

export const localSalesDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
