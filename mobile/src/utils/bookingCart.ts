import type { BulkBookingItem } from '@/types/api.types';
import { normalizeLicensePlate } from './profileValidation';

export interface BookingCartItem extends BulkBookingItem {
  clientItemId: string;
  plateLabel: string;
  floorLabel: string;
  voucherLabel?: string;
}

export function getCartConflict(items: BookingCartItem[], candidate: BookingCartItem) {
  for (const item of items) {
    if (item.clientItemId === candidate.clientItemId) continue;
    if (candidate.voucherId && item.voucherId === candidate.voucherId)
      return 'This voucher is already assigned to another cart item.';
    const overlaps =
      new Date(item.startTime) < new Date(candidate.endTime) &&
      new Date(candidate.startTime) < new Date(item.endTime);
    if (!overlaps) continue;
    if (
      item.floorId === candidate.floorId &&
      item.slotCode.toUpperCase() === candidate.slotCode.toUpperCase()
    )
      return 'This space is already in your cart for the same time.';
    if (normalizeLicensePlate(item.plateLabel) === normalizeLicensePlate(candidate.plateLabel))
      return 'This vehicle has an overlapping reservation in your cart.';
  }
  return null;
}

export const toBookingApiItem = ({
  plateLabel: _plate,
  floorLabel: _floor,
  voucherLabel: _voucher,
  ...item
}: BookingCartItem): BulkBookingItem => item;
