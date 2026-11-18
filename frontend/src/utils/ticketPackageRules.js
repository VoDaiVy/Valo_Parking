export const MEMBERSHIP_PACKAGE_TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
export const SELLABLE_PACKAGE_TYPES = ['weekly', 'monthly', 'yearly', 'custom'];
export const isSellablePackageType = (type) => SELLABLE_PACKAGE_TYPES.includes(type);

export const isMembershipPackageType = (type) => MEMBERSHIP_PACKAGE_TYPES.includes(type);

export const getPackageTypeLabel = (packageOrType, t) => {
  const type = typeof packageOrType === 'string' ? packageOrType : packageOrType?.type;
  const labels = { hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom' };
  const key = Object.hasOwn(labels, type) ? type : 'member';
  return t ? t(`membershipPage.${key}`) : labels[key] || 'Membership';
};

export const getPackageDurationLabel = (pkg, t) => {
  if (pkg?.type === 'hourly') return t ? t('membershipPage.durationHours', { count: 1 }) : '1 hour';
  if (pkg?.type === 'monthly') return t ? t('membershipPage.durationMonth') : '1 month';
  if (pkg?.type === 'yearly') return t ? t('membershipPage.durationYear') : '1 year';
  if (pkg?.type === 'custom' && pkg.durationMinutes) {
    const days = Math.floor(pkg.durationMinutes / 1440);
    const hours = Math.floor((pkg.durationMinutes % 1440) / 60);
    const minutes = pkg.durationMinutes % 60;
    return [
      days && (t ? t('membershipPage.durationDays', { count: days }) : `${days}d`),
      hours && (t ? t('membershipPage.durationHours', { count: hours }) : `${hours}h`),
      minutes && (t ? t('servicesPage.minutes', { value: minutes }) : `${minutes}m`),
    ].filter(Boolean).join(' ');
  }
  const days = ({ daily: 1, weekly: 7 })[pkg?.type] || Number(pkg?.durationDays);
  if (Number.isInteger(days) && days > 0) {
    return t ? t('membershipPage.durationDays', { count: days }) : `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return t ? t('membershipPage.membershipPeriod') : 'Membership period';
};

const defaultPackageCopy = new Map([
  ['premium monthly', 'premiumMonthly'],
  ['vip yearly', 'yearlyVip'],
  ['monthly subscription with priority', 'monthlyPriorityDescription'],
  ['vip yearly package', 'yearlyVipDescription'],
  ['all monthly vip benefits', 'monthlyBenefits'],
  ['includes 12 free washes / maintenance services', 'yearlyWashes'],
  ['priority support', 'prioritySupport'],
  ['all member benefits', 'memberBenefits'],
  ['own a fixed parking slot under your name', 'ownSlot'],
  ['free 24/7 automatic check-in', 'automaticCheckin'],
  ['no need to book before arrival', 'noAdvanceBooking'],
]);

export const localizePackageCopy = (value, t) => {
  const key = defaultPackageCopy.get(value?.trim().toLowerCase());
  return key ? t(`membershipPage.${key}`) : value;
};
