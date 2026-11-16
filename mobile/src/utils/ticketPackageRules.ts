import type { SubscriptionPackage, SubscriptionPackageType } from '@/types/subscription.types';

export const MEMBERSHIP_PACKAGE_TYPES: readonly string[] = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];

export const isMembershipPackageType = (type: string | null | undefined): type is SubscriptionPackageType =>
  MEMBERSHIP_PACKAGE_TYPES.includes(type || '');

export const getPackageDurationLabel = (pkg: { type: string; durationDays?: number; durationMinutes?: number; duration?: SubscriptionPackage['duration'] }) => {
  if (pkg.duration?.value && !(pkg.type === 'custom' && pkg.durationMinutes)) {
    const unit = ['calendarMonths', 'months'].includes(pkg.duration.unit) ? 'calendar months' : pkg.duration.unit;
    return `${pkg.duration.value} ${unit}`;
  }
  if (pkg.type === 'custom' && pkg.durationMinutes) {
    const days = Math.floor(pkg.durationMinutes / 1440);
    const hours = Math.floor((pkg.durationMinutes % 1440) / 60);
    const minutes = pkg.durationMinutes % 60;
    return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ');
  }
  const labels: Record<string, string> = { daily: '1 day', weekly: '7 days', monthly: '1 month', yearly: '12 months' };
  return labels[pkg.type] || `${pkg.durationDays ?? 0} days`;
};
