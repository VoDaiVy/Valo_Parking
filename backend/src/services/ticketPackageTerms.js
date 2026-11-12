const crypto = require('crypto');

// Historical records without terms remain explicitly legacy; never reconstruct
// their benefits from a catalog entry that an administrator may have edited.
const durationForType = (type) => ({
  monthly: { unit: 'hours', value: 720 },
  yearly: { unit: 'calendarMonths', value: 12 },
  daily: { unit: 'hours', value: 24 },
  hourly: { unit: 'hours', value: 1 },
}[type]);

const invalidTerms = (message) => Object.assign(new Error(message), { statusCode: 400 });
const packageDuration = (pkg) => {
  const duration = pkg.duration && (pkg.duration.value != null || pkg.duration.unit != null) ? pkg.duration : durationForType(pkg.type);
  const unit = duration?.unit === 'months' ? 'calendarMonths' : duration?.unit;
  if (!duration || !Number.isSafeInteger(duration.value) || duration.value < 1 || !['hours', 'days', 'calendarMonths'].includes(unit))
    throw invalidTerms('Duration must be a positive whole number of hours, days or months.');
  return { unit, value: duration.value };
};

const addConfiguredDuration = (fromDate, pkg) => {
  const start = new Date(fromDate);
  const { value, unit } = packageDuration(pkg);
  let end;
  if (unit === 'calendarMonths') {
    end = new Date(start);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + value);
    const last = new Date(end);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    end.setUTCDate(Math.min(day, last.getUTCDate()));
  } else end = new Date(start.getTime() + value * (unit === 'days' ? 86400000 : 3600000));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
    throw invalidTerms('The configured duration is outside the supported date range.');
  return end;
};

const salesAvailability = (pkg, now = new Date()) => {
  const state = pkg.isActive === false ? 'inactive'
    : pkg.salesStartAt && new Date(pkg.salesStartAt) > now ? 'upcoming'
    : pkg.salesEndAt && new Date(pkg.salesEndAt) <= now ? 'ended' : 'available';
  return { available: state === 'available', state, message: {
    inactive: 'This package is inactive.', upcoming: 'Sales have not started yet.',
    ended: 'Sales have ended. Existing purchased benefits remain valid.', available: 'Available for purchase.',
  }[state] };
};

const validatePackageConfiguration = (input) => {
  const duration = packageDuration(input);
  addConfiguredDuration(new Date('2000-01-01T00:00:00Z'), { duration });
  const date = (value) => {
    if (value === '' || value == null) return null;
    if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value))) throw invalidTerms('Sales dates must include a valid date, time and timezone.');
    if (typeof value === 'string' && !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw invalidTerms('Sales dates must include a timezone.');
    if (typeof value === 'string') {
      const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
      if (!parts || Number(parts[2]) < 1 || Number(parts[2]) > 12 || Number(parts[3]) < 1
        || Number(parts[3]) > new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate()
        || Number(parts[4]) > 23 || Number(parts[5]) > 59) throw invalidTerms('Invalid sales date or time.');
    }
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw invalidTerms('Invalid sales date.');
    return result;
  };
  const salesStartAt = date(input.salesStartAt), salesEndAt = date(input.salesEndAt);
  if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) throw invalidTerms('Sales end must be after sales start.');
  const optionalServiceIds = input.optionalServiceIds === undefined ? [] : input.optionalServiceIds;
  if (!Array.isArray(optionalServiceIds) || optionalServiceIds.some((id) => !/^[a-f0-9]{24}$/i.test(String(id))) || new Set(optionalServiceIds.map(String)).size !== optionalServiceIds.length)
    throw invalidTerms('Select each supported optional service only once.');
  return { duration, salesStartAt, salesEndAt, optionalServiceIds };
};

const serviceConfiguration = (kind) => ['RESERVED_FREE', 'RESERVED_PAID'].includes(kind) ? {
  kind, eligibility: 'BOUND_VEHICLE_REGISTERED_SLOT',
  baseParkingFee: kind === 'RESERVED_FREE' ? 'WAIVED_WHILE_EFFECTIVE' : 'NORMAL_PRICING',
  auxiliaryServices: 'CHARGED_SEPARATELY',
} : null;

const comparableDuration = (pkg) => {
  const duration = packageDuration(pkg);
  return duration.unit === 'days' ? { unit: 'hours', value: duration.value * 24 } : duration;
};

const canonicalConfiguration = (pkg) => JSON.stringify({
  type: pkg.type,
  service: pkg.service || 'LEGACY_RESERVED',
  duration: comparableDuration(pkg),
  ...((pkg.optionalServiceIds || []).length ? { optionalServiceIds: pkg.optionalServiceIds.map(String).sort() } : {}),
  price: Number(pkg.price),
  maxSlots: Number(pkg.maxSlots ?? 3),
  renewalWindowDays: Number(pkg.renewalWindowDays ?? 7),
  isRenewable: pkg.isRenewable !== false,
});

const configurationKey = (pkg) => crypto.createHash('sha256')
  .update(canonicalConfiguration(pkg)).digest('hex');

const snapshotPackage = (pkg) => ({
  id: pkg._id,
  version: pkg.updatedAt,
  name: pkg.name,
  type: pkg.type,
  unitPrice: Number(pkg.price),
  duration: packageDuration(pkg),
  optionalServices: (pkg.optionalServices || []).map((item) => ({ ...item, id: item.id })),
  optionalServiceIds: (pkg.optionalServiceIds || []).map(String),
  maxSlots: pkg.maxSlots,
  renewalWindowDays: pkg.renewalWindowDays,
  isRenewable: pkg.isRenewable,
  service: pkg.service || 'LEGACY_RESERVED',
  serviceConfiguration: serviceConfiguration(pkg.service),
  benefitMode: pkg.service ? 'configured' : 'legacy_reserved_parking',
  auxiliaryServicesIncluded: false,
});

const assertPaymentMatches = (payment, orderCode, amount) => {
  // PayOS payment-link API settles in VND; reject a contradictory currency
  // if a provider response explicitly supplies one.
  if (!payment || payment.status !== 'PAID' || !Number.isSafeInteger(Number(amount)) || Number(amount) < 0
    || Number(payment.orderCode) !== Number(orderCode)
    || Number(payment.amount) !== Number(amount)
    || (!Number.isFinite(Number(payment.amountPaid)) || Number(payment.amountPaid) !== Number(amount))
    || Number(payment.amountRemaining || 0) !== 0
    || (payment.currency && payment.currency !== 'VND')) {
    throw Object.assign(new Error('Payment identity or amount does not match the purchase.'), {
      statusCode: 409, code: 'PAYMENT_MISMATCH',
    });
  }
};

module.exports = { serviceConfiguration, durationForType, packageDuration, addConfiguredDuration, salesAvailability, validatePackageConfiguration, canonicalConfiguration, configurationKey, snapshotPackage, assertPaymentMatches };
