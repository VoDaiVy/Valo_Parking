import * as fc from 'fast-check';

import { isValidBookingQrValue } from '../QRCodeDisplay';

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (message: string) => message }),
}));

describe('QRCodeDisplay properties', () => {
  // Feature: customer-core-features, Property 7: QR Code Format Validity
  it('accepts 24-character hexadecimal MongoDB ObjectId values', () => {
    const objectIdArbitrary = fc
      .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
        minLength: 24,
        maxLength: 24,
      })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(objectIdArbitrary, (value) => {
        expect(isValidBookingQrValue(value)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts signed VALO booking QR payloads', () => {
    expect(
      isValidBookingQrValue(
        'VALO_BOOKING:1:507f1f77bcf86cd799439011:abcdefghijklmnopqrstuvwxyz0123456789_-',
      ),
    ).toBe(true);
    expect(
      isValidBookingQrValue(
        'VALO_BOOKING:2:507f1f77bcf86cd799439011:abcdefghijklmnopqrstuvwxyz0123456789_-',
      ),
    ).toBe(true);
  });

  it('rejects unsigned VALO booking QR payloads', () => {
    expect(isValidBookingQrValue('VALO_BOOKING:1:507f1f77bcf86cd799439011')).toBe(false);
  });

  it('accepts signed membership QR payloads', () => {
    expect(
      isValidBookingQrValue(
        'VALO_MEMBERSHIP:1:507f1f77bcf86cd799439011:abcdefghijklmnopqrstuvwxyz0123456789_-',
      ),
    ).toBe(true);
  });
});
