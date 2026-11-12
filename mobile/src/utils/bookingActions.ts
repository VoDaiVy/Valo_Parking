import type { BookingStatus } from '@/types/booking.types';

interface BookingActionInput {
  status: BookingStatus;
  startTime: string;
  endTime: string;
  modificationCount?: number;
}

const MINUTE = 60_000;

export const getBookingActionAvailability = (booking: BookingActionInput, now = Date.now()) => {
  const start = new Date(booking.startTime).getTime();
  const end = new Date(booking.endTime).getTime();
  const validRange = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const modificationAllowed = (booking.modificationCount ?? 0) < 3;

  return {
    canCancel: booking.status === 'confirmed' && validRange && start > now,
    canChangeVehicle:
      modificationAllowed && booking.status === 'confirmed' && validRange && start > now,
    canCheckIn:
      booking.status === 'confirmed' &&
      validRange &&
      now >= start - 30 * MINUTE &&
      now <= start + 15 * MINUTE &&
      now <= end,
    canCheckOut: booking.status === 'active',
    canExtend:
      modificationAllowed &&
      validRange &&
      (booking.status === 'active' ||
        booking.status === 'paused' ||
        (booking.status === 'confirmed' && start - now >= 30 * MINUTE)),
  };
};

export const canExtendBookingBy = (booking: BookingActionInput, minutes: number, now = Date.now()) => {
  const start = new Date(booking.startTime).getTime();
  const end = new Date(booking.endTime).getTime();
  const extendedEnd = end + minutes * MINUTE;

  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    minutes > 0 &&
    extendedEnd > now &&
    extendedEnd - start >= 60 * MINUTE
  );
};
