import { getCartConflict, toBookingApiItem, type BookingCartItem } from '../bookingCart';

const item: BookingCartItem = {
  clientItemId: 'first',
  floorId: 'floor-1',
  slotCode: 'A01',
  plateLabel: '30A-12345',
  floorLabel: 'Floor 1',
  vehicleId: 'vehicle-1',
  startTime: '2030-01-01T01:00:00Z',
  endTime: '2030-01-01T03:00:00Z',
  voucherId: 'voucher-1',
};

describe('booking cart conflicts', () => {
  it('blocks the same vehicle despite different plate punctuation', () => {
    expect(
      getCartConflict([item], {
        ...item,
        clientItemId: 'second',
        slotCode: 'B02',
        plateLabel: '30A12345',
        voucherId: undefined,
      }),
    ).toMatch(/vehicle/);
  });
  it('blocks double selection of a slot in the same floor and time', () => {
    expect(
      getCartConflict([item], {
        ...item,
        clientItemId: 'second',
        plateLabel: '51A98765',
        voucherId: undefined,
      }),
    ).toMatch(/space/);
  });
  it('allows adjacent reservations and the same slot code on another floor', () => {
    expect(
      getCartConflict([item], {
        ...item,
        clientItemId: 'second',
        startTime: item.endTime,
        endTime: '2030-01-01T04:00:00Z',
        voucherId: undefined,
      }),
    ).toBeNull();
    expect(
      getCartConflict([item], {
        ...item,
        clientItemId: 'second',
        floorId: 'floor-2',
        plateLabel: '51A98765',
        voucherId: undefined,
      }),
    ).toBeNull();
  });
  it('blocks reuse of the same voucher even on nonoverlapping bookings', () => {
    expect(
      getCartConflict([item], {
        ...item,
        clientItemId: 'second',
        startTime: item.endTime,
        endTime: '2030-01-01T04:00:00Z',
      }),
    ).toMatch(/voucher/);
  });
  it('sends the voucher and reservation fields without UI labels', () => {
    expect(toBookingApiItem({ ...item, voucherLabel: 'Reward' })).toEqual({
      clientItemId: 'first',
      floorId: 'floor-1',
      slotCode: 'A01',
      vehicleId: 'vehicle-1',
      startTime: item.startTime,
      endTime: item.endTime,
      voucherId: 'voucher-1',
    });
  });
});
