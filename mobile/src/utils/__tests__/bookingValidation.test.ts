import * as fc from 'fast-check';

import { validateTimeRange, validateWalletBalance } from '../bookingValidation';

describe('bookingValidation properties', () => {
  // Feature: customer-core-features, Property 1: Time Range Validity
  it('accepts future ranges from 30 minutes including multi-day bookings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 240 }),
        fc.integer({ min: 30, max: 14 * 24 * 60 }),
        (startOffsetMinutes, durationMinutes) => {
          const start = new Date(Date.now() + startOffsetMinutes * 60 * 1000);
          const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

          expect(validateTimeRange(start, end).valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects invalid dates and durations below the backend minimum', () => {
    const start = new Date(Date.now() + 3_600_000);
    expect(validateTimeRange(new Date('invalid'), start).valid).toBe(false);
    expect(validateTimeRange(start, new Date(start.getTime() + 29 * 60_000)).valid).toBe(false);
    expect(validateTimeRange(start, start).valid).toBe(false);
  });

  // Feature: customer-core-features, Property 6: Wallet Balance Sufficiency
  it('requires wallet balance to cover total cost', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (balance, required) => {
          expect(validateWalletBalance(balance, required).valid).toBe(balance >= required);
        },
      ),
      { numRuns: 100 },
    );
  });
});
