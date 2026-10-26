import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { BookingCartScreen } from '../BookingCartScreen';
import { bookingService } from '@/services/BookingService';
import { walletService } from '@/services/api/wallet';

jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/components/common', () => {
  const { Text } = require('react-native');
  return {
    ScreenHeader: () => null,
    EmptyState: () => null,
    ErrorState: ({ message }: { message: string }) => <Text>{message}</Text>,
  };
});
jest.mock('@/services/BookingService', () => ({
  bookingService: {
    quoteBulkBooking: jest.fn(),
    createBookingHold: jest.fn(),
    createBulkBooking: jest.fn(),
    releaseBookingHold: jest.fn(),
  },
}));
jest.mock('@/services/api/wallet', () => ({ walletService: { getWallet: jest.fn() } }));
const mockClear = jest.fn();
const mockItems = [
  {
    clientItemId: 'a',
    floorId: 'f1',
    slotCode: 'A01',
    vehicleId: 'v1',
    plateLabel: '30A12345',
    floorLabel: 'Floor 1',
    startTime: '2030-01-01T01:00:00Z',
    endTime: '2030-01-01T02:00:00Z',
  },
  {
    clientItemId: 'b',
    floorId: 'f1',
    slotCode: 'A02',
    vehicleId: 'v2',
    plateLabel: '30A98765',
    floorLabel: 'Floor 1',
    startTime: '2030-01-01T01:00:00Z',
    endTime: '2030-01-01T02:00:00Z',
  },
];
jest.mock('@/contexts/BookingCartContext', () => ({
  useBookingCart: () => ({
    items: mockItems,
    checkoutKey: 'stable-attempt-key',
    clear: mockClear,
    remove: jest.fn(),
  }),
}));
jest.mock('@/hooks/useBooking', () => ({
  useBooking: () => ({
    fetchBookings: jest.fn().mockResolvedValue(undefined),
    fetchWalletBalance: jest.fn().mockResolvedValue(undefined),
  }),
}));

const quote = {
  success: true,
  data: { grandTotal: 20000, items: [{ totalAmount: 10000 }, { totalAmount: 10000 }] },
};
const props = {
  navigation: { goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn(), getParent: jest.fn() },
  route: { key: 'cart', name: 'BookingCart' },
};
const screenProps = props as unknown as React.ComponentProps<typeof BookingCartScreen>;

describe('booking cart checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(bookingService.quoteBulkBooking).mockResolvedValue(quote as never);
    jest
      .mocked(walletService.getWallet)
      .mockResolvedValue({ success: true, data: { balance: 100000 } } as never);
    jest.mocked(bookingService.releaseBookingHold).mockResolvedValue({ success: true } as never);
    jest
      .mocked(bookingService.createBookingHold)
      .mockResolvedValue({ success: true, data: { _id: 'hold-1' } } as never);
    jest.mocked(bookingService.createBulkBooking).mockResolvedValue({
      success: true,
      data: { bookings: [{ _id: 'booking-1' }, { _id: 'booking-2' }] },
    } as never);
  });

  it('requires another confirmation if the server price changes before debit', async () => {
    jest
      .mocked(bookingService.quoteBulkBooking)
      .mockResolvedValueOnce(quote as never)
      .mockResolvedValueOnce({ ...quote, data: { ...quote.data, grandTotal: 21000 } } as never);
    const ui = render(<BookingCartScreen {...screenProps} />);
    fireEvent.press(await ui.findByText('Confirm & pay with wallet'));
    await ui.findByText('The price has changed. Please review the new total and confirm again.');
    expect(bookingService.createBookingHold).not.toHaveBeenCalled();
    expect(bookingService.createBulkBooking).not.toHaveBeenCalled();
  });

  it('releases acquired holds when a later hold fails and retains the cart', async () => {
    jest
      .mocked(bookingService.createBookingHold)
      .mockResolvedValueOnce({ success: true, data: { _id: 'first-hold' } } as never)
      .mockRejectedValueOnce(new Error('Space unavailable'));
    const ui = render(<BookingCartScreen {...screenProps} />);
    fireEvent.press(await ui.findByText('Confirm & pay with wallet'));
    await waitFor(() =>
      expect(bookingService.releaseBookingHold).toHaveBeenCalledWith('first-hold'),
    );
    expect(bookingService.createBulkBooking).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('submits all items with the stable idempotency key and clears only after success', async () => {
    const ui = render(<BookingCartScreen {...screenProps} />);
    fireEvent.press(await ui.findByText('Confirm & pay with wallet'));
    await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
    expect(bookingService.createBulkBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'stable-attempt-key',
        expectedTotal: 20000,
        items: expect.arrayContaining([
          expect.objectContaining({ slotCode: 'A01' }),
          expect.objectContaining({ slotCode: 'A02' }),
        ]),
      }),
    );
    expect(bookingService.releaseBookingHold).not.toHaveBeenCalled();
  });
});
