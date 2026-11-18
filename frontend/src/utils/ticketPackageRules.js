export const MEMBERSHIP_PACKAGE_TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
export const SELLABLE_PACKAGE_TYPES = ['weekly', 'monthly', 'yearly', 'custom'];
export const isSellablePackageType = (type) => SELLABLE_PACKAGE_TYPES.includes(type);

export const isMembershipPackageType = (type) => MEMBERSHIP_PACKAGE_TYPES.includes(type);

export const getPackageTypeLabel = (packageOrType) => {
  const type = typeof packageOrType === 'string' ? packageOrType : packageOrType?.type;
  return ({ hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom' })[type] || 'Membership';
};

export const getPackageDurationLabel = (pkg) => {
  if (pkg?.type === 'hourly') return '1 hour';
  if (pkg?.type === 'monthly') return '1 month';
  if (pkg?.type === 'yearly') return '1 year';
  if (pkg?.type === 'custom' && pkg.durationMinutes) {
    const days = Math.floor(pkg.durationMinutes / 1440);
    const hours = Math.floor((pkg.durationMinutes % 1440) / 60);
    const minutes = pkg.durationMinutes % 60;
    return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ');
  }
  const days = ({ daily: 1, weekly: 7 })[pkg?.type] || Number(pkg?.durationDays);
  return Number.isInteger(days) && days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'Membership period';
};
