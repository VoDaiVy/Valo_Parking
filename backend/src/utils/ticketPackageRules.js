const PACKAGE_TYPES = ['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const MEMBERSHIP_PACKAGE_TYPES = PACKAGE_TYPES.filter((type) => type !== 'hourly');
const DAY_MS = 24 * 60 * 60 * 1000;

const isMembershipPackageType = (type) => MEMBERSHIP_PACKAGE_TYPES.includes(type);

const getPackageDurationMinutes = (pkg) => {
  if (pkg?.type !== 'custom') return null;
  if (pkg.durationMinutes == null && (!Number.isInteger(pkg.durationDays) || pkg.durationDays < 1)) return null;
  const minutes = pkg.durationMinutes ?? (pkg.durationDays == null ? null : pkg.durationDays * 1440);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 3650 * 1440 ? minutes : null;
};

const getPackageDurationDays = (pkg) => {
  const type = typeof pkg === 'string' ? pkg : pkg?.type;
  const daysByType = { daily: 1, weekly: 7, monthly: 30, yearly: 365 };
  if (type !== 'custom') return daysByType[type] ?? null;
  const minutes = getPackageDurationMinutes(pkg);
  return minutes ? minutes / 1440 : null;
};

const buildPackageExpirationDate = (pkg, fromDate = new Date()) => {
  const type = typeof pkg === 'string' ? pkg : pkg?.type;
  const result = new Date(fromDate);
  if (Number.isNaN(result.getTime()) || !isMembershipPackageType(type)) {
    throw Object.assign(new Error('Invalid membership duration.'), { statusCode: 400 });
  }
  if (type === 'monthly' || type === 'yearly') {
    const originalDay = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + (type === 'yearly' ? 12 : 1));
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(originalDay, lastDay));
    return result;
  }
  const days = getPackageDurationDays(pkg);
  if (!days) throw Object.assign(new Error('Specify a valid membership duration in days.'), { statusCode: 400 });
  return new Date(result.getTime() + days * DAY_MS);
};

const getPackageBenefits = (pkg) => {
  const type = typeof pkg === 'string' ? pkg : pkg?.type;
  if (!isMembershipPackageType(type)) return [];
  if (pkg?.benefitsVersion >= 1) {
    return [
      ...(pkg.displayBenefits || []),
      ...(pkg.serviceBenefits || []).map((benefit) => `${benefit.serviceName}: ${benefit.quantityPerSlot} use(s) per space`),
    ];
  }
  return type === 'yearly'
    ? ['Reserved VIP slots', '12 free services', 'Priority parking access']
    : ['Reserved VIP slots', 'Priority parking access'];
};

module.exports = {
  PACKAGE_TYPES,
  MEMBERSHIP_PACKAGE_TYPES,
  isMembershipPackageType,
  getPackageDurationDays,
  getPackageDurationMinutes,
  buildPackageExpirationDate,
  getPackageBenefits,
};
