import * as fc from 'fast-check';

import type { WalletTransaction } from '@/types/models';

import {
  calculateExpirationDate,
  calculateSubscriptionTotal,
  calculateWalletBalanceFromTransactions,
  getSubscriptionPackageRestriction,
  isValidTopUpAmount,
  isVipActive,
  TOP_UP_MIN_AMOUNT,
  validateSubscriptionSlots,
} from '../walletSubscription';

const transactionArbitrary = fc.record({
  type: fc.constantFrom('TOP_UP', 'PAYMENT', 'REFUND'),
  amount: fc.integer({ min: 1000, max: 10_000_000 }),
  status: fc.constantFrom('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'),
});

describe('walletSubscription properties', () => {
  // Feature: wallet-subscription-management, Property 1: Wallet Balance Consistency
  it('computes balance from completed top-up/refund minus payment transactions', () => {
    fc.assert(
      fc.property(fc.array(transactionArbitrary, { maxLength: 50 }), (transactions) => {
        const expected = transactions
          .filter((transaction) => transaction.status === 'COMPLETED')
          .reduce((balance, transaction) => {
            if (transaction.type === 'TOP_UP' || transaction.type === 'REFUND') {
              return balance + transaction.amount;
            }
            return balance - transaction.amount;
          }, 0);

        expect(calculateWalletBalanceFromTransactions(transactions as WalletTransaction[])).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: wallet-subscription-management, Property 4: Top-Up Minimum Amount Validation
  it('accepts top-up amounts greater than or equal to the minimum', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (amount) => {
        expect(isValidTopUpAmount(amount)).toBe(amount >= TOP_UP_MIN_AMOUNT);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: wallet-subscription-management, Property 19 and 20: Slot Selection Limits
  it('limits selected slots to max 3 and registered vehicle count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (selectedCount, vehicleCount) => {
          const maxAllowed = Math.min(3, vehicleCount);
          expect(validateSubscriptionSlots(selectedCount, vehicleCount)).toBe(
            selectedCount > 0 && selectedCount <= maxAllowed,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('calculates the subscription price for every reserved slot', () => {
    expect(calculateSubscriptionTotal(100_000, 0)).toBe(100_000);
    expect(calculateSubscriptionTotal(100_000, 1)).toBe(100_000);
    expect(calculateSubscriptionTotal(100_000, 3)).toBe(300_000);
  });

  it('allows purchasing independent slot entitlements with a different duration', () => {
    const membership = {
      isVip: true,
      package: { id: 'year', type: 'yearly' },
    } as any;

    expect(getSubscriptionPackageRestriction(membership, { _id: 'year', type: 'yearly' } as any)).toBeNull();
    expect(getSubscriptionPackageRestriction(membership, { _id: 'month', type: 'monthly' } as any)).toBeNull();
    expect(getSubscriptionPackageRestriction({ ...membership, package: { id: 'month', type: 'monthly' } }, { _id: 'year', type: 'yearly' } as any)).toBeNull();
  });

  // Feature: wallet-subscription-management, Property 22: Subscription Expiration Calculation
  it('calculates monthly and yearly expiration dates', () => {
    const purchaseDate = new Date('2030-01-15T00:00:00.000Z');

    expect(calculateExpirationDate('monthly', purchaseDate).getMonth()).toBe(1);
    expect(calculateExpirationDate('yearly', purchaseDate).getFullYear()).toBe(2031);
  });

  // Feature: wallet-subscription-management, Property 31: VIP Status Expiration Check
  it('considers VIP active only before expiration', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');

    expect(isVipActive(true, '2030-01-02T00:00:00.000Z', now)).toBe(true);
    expect(isVipActive(true, '2029-12-31T00:00:00.000Z', now)).toBe(false);
    expect(isVipActive(false, '2030-01-02T00:00:00.000Z', now)).toBe(false);
  });
});
