import type { WalletTransaction } from '@/types/models';
import type { MembershipStatus, SubscriptionPackage, SubscriptionPackageType } from '@/types/subscription.types';

export const TOP_UP_MIN_AMOUNT = 1000;
export const SUBSCRIPTION_SLOT_LIMIT = 3;

export const isValidTopUpAmount = (amount: number) => Number.isFinite(amount) && amount >= TOP_UP_MIN_AMOUNT;

export const calculateWalletBalanceFromTransactions = (transactions: WalletTransaction[]) =>
  transactions
    .filter((transaction) => transaction.status === 'COMPLETED')
    .reduce((balance, transaction) => {
      if (transaction.type === 'TOP_UP' || transaction.type === 'REFUND') {
        return balance + transaction.amount;
      }
      if (transaction.type === 'PAYMENT') {
        return balance - transaction.amount;
      }
      return balance;
    }, 0);

export const calculateExpirationDate = (packageType: SubscriptionPackageType, fromDate = new Date(), durationDays?: number, durationMinutes?: number, duration?: SubscriptionPackage['duration']) => {
  const expireAt = new Date(fromDate);
  if (duration && ['minutes', 'hours', 'days'].includes(duration.unit)) {
    const multiplier = duration.unit === 'days' ? 86400000 : duration.unit === 'hours' ? 3600000 : 60000;
    return new Date(expireAt.getTime() + duration.value * multiplier);
  }
  if (!duration && packageType === 'monthly') {
    return new Date(expireAt.getTime() + 720 * 3600000);
  }
  if (duration?.unit === 'calendarMonths' || duration?.unit === 'months' || packageType === 'yearly') {
    const originalDay = expireAt.getUTCDate();
    expireAt.setUTCDate(1);
    expireAt.setUTCMonth(expireAt.getUTCMonth() + (duration?.value ?? 12));
    const lastDay = new Date(Date.UTC(expireAt.getUTCFullYear(), expireAt.getUTCMonth() + 1, 0)).getUTCDate();
    expireAt.setUTCDate(Math.min(originalDay, lastDay));
    return expireAt;
  }
  if (packageType === 'custom' && durationMinutes !== undefined) {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 5256000) throw new Error('Invalid membership duration.');
    return new Date(expireAt.getTime() + durationMinutes * 60000);
  }
  const days = packageType === 'daily' ? 1 : packageType === 'weekly' ? 7 : durationDays;
  if (!Number.isInteger(days) || !days || days < 1 || days > 3650) throw new Error('Invalid membership duration.');
  return new Date(expireAt.getTime() + days * 24 * 60 * 60 * 1000);
};

export const validateSubscriptionSlots = (selectedCount: number, vehicleCount: number) => {
  const maxAllowed = Math.min(SUBSCRIPTION_SLOT_LIMIT, vehicleCount);
  return selectedCount > 0 && selectedCount <= maxAllowed;
};

export const calculateSubscriptionTotal = (packagePrice: number, selectedSlotCount: number) =>
  Math.max(Number(packagePrice) || 0, 0) * Math.max(1, selectedSlotCount);

export const getSubscriptionPackageRestriction = (
  membership: MembershipStatus | null,
  pkg: SubscriptionPackage | undefined,
) => {
  // Slot entitlements are independent, so an active membership does not block
  // purchasing another slot or choosing a different duration for that slot.
  if (!membership || !pkg) return null;
  return null;
};

export const isVipActive = (isVip: boolean, expireAt?: string | null, now = new Date()) =>
  Boolean(isVip && expireAt && new Date(expireAt) > now);
