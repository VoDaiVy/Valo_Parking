import { canExtendBookingBy, getBookingActionAvailability } from '../bookingActions';

const NOW = new Date('2026-07-13T06:00:00.000Z').getTime();

const booking = {
  status: 'confirmed' as const,
  startTime: '2026-07-13T07:00:00.000Z',
  endTime: '2026-07-13T09:00:00.000Z',
  modificationCount: 0,
};

describe('booking action availability', () => {
  it('allows cancellation and extension before the backend 30-minute cutoff', () => {
    expect(getBookingActionAvailability(booking, NOW)).toMatchObject({
      canCancel: true,
      canChangeVehicle: true,
      canCheckIn: false,
      canExtend: true,
    });
  });

  it('only enables check-in from 30 minutes before until 15 minutes after start', () => {
    expect(getBookingActionAvailability(booking, new Date('2026-07-13T06:29:59.000Z').getTime()).canCheckIn).toBe(false);
    expect(getBookingActionAvailability(booking, new Date('2026-07-13T06:30:00.000Z').getTime()).canCheckIn).toBe(true);
    expect(getBookingActionAvailability(booking, new Date('2026-07-13T07:15:00.000Z').getTime()).canCheckIn).toBe(true);
    expect(getBookingActionAvailability(booking, new Date('2026-07-13T07:15:01.000Z').getTime()).canCheckIn).toBe(false);
  });

  it('blocks extension after three modifications', () => {
    expect(getBookingActionAvailability({ ...booking, modificationCount: 3 }, NOW).canExtend).toBe(false);
    expect(getBookingActionAvailability({ ...booking, modificationCount: 3 }, NOW).canChangeVehicle).toBe(false);
  });

  it('blocks changing vehicle after the booking starts', () => {
    expect(getBookingActionAvailability(booking, new Date(booking.startTime).getTime()).canChangeVehicle).toBe(false);
  });

  it('allows active bookings to extend and check out', () => {
    expect(getBookingActionAvailability({ ...booking, status: 'active' }, NOW)).toMatchObject({
      canExtend: true,
      canCheckOut: true,
      canCancel: false,
    });
  });

  it('allows multi-day extensions like the shared booking backend', () => {
    const nearLimit = {
      ...booking,
      endTime: '2026-07-14T06:30:00.000Z',
    };

    expect(canExtendBookingBy(nearLimit, 30, NOW)).toBe(true);
    expect(canExtendBookingBy(nearLimit, 60, NOW)).toBe(true);
  });

  it('blocks an extension option when the resulting end time is still in the past', () => {
    const expiredEnd = {
      ...booking,
      status: 'active' as const,
      startTime: '2026-07-13T03:00:00.000Z',
      endTime: '2026-07-13T04:00:00.000Z',
    };

    expect(canExtendBookingBy(expiredEnd, 60, NOW)).toBe(false);
  });
});
