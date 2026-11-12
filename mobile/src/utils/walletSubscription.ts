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

export const calculateExpirationDate = (packageType: SubscriptionPackageType, fromDate = new Date()) => {
  const expireAt = new Date(fromDate);
  if (packageType === 'monthly') {
    expireAt.setTime(expireAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else {
    expireAt.setFullYear(expireAt.getFullYear() + 1);
  }
  return expireAt;
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
