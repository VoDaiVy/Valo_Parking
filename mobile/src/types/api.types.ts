import type { AvailableSlot, Booking, BookingServiceItem, Service, Session } from './booking.types';
import type { APIResponse, PaginatedResponse } from './api';

export interface GetAvailableSlotsRequest {
  startTime: string;
  endTime: string;
}

export interface BookingMembershipPolicy {
  activeMembership: boolean;
  membershipType: 'monthly' | 'yearly' | null;
  assignedSlotOccupied: boolean;
  requiresAssignedSlotUse: boolean;
  reservedSlots: Array<{ floorId: string; slotCode: string }>;
}

export interface AvailableSlotsData {
  startTime?: string;
  endTime?: string;
  count?: number;
  slots?: AvailableSlot[];
  bookingPolicy?: BookingMembershipPolicy;
}

export interface GetAvailableSlotsResponse extends APIResponse<AvailableSlot[] | AvailableSlotsData> {
  count?: number;
}

export interface CreateBookingRequest {
  startTime: string;
  endTime: string;
  floorId: string;
  slotCode: string;
  vehicleId: string;
  serviceIds?: string[];
  services?: Service[];
  paymentMethod?: 'wallet' | 'vietqr';
}

export interface BulkBookingItem {
  clientItemId?: string;
  vehicleId?: string;
  licensePlate?: string;
  floorId: string;
  slotCode: string;
  startTime: string;
  endTime: string;
  serviceIds?: string[];
  holdId?: string;
  voucherId?: string;
}

export interface BulkBookingQuoteResponse extends APIResponse<{
  grandTotal: number;
  items: Array<{
    clientItemId?: string;
    parkingSlot: string;
    vehicleId?: string;
    totalAmount: number;
    servicesTotal: number;
    voucherDiscount?: number;
    earlyBookingDiscount?: number;
  }>;
}> {}

export interface BookingHoldResponse extends APIResponse<{
  _id: string;
  floorId: string;
  slotCode: string;
  expiresAt: string;
}> {}

export interface BulkBookingResponse extends APIResponse<{
  transaction: unknown;
  bookings: Booking[];
}> {}

export interface CreateBookingData {
  booking: Booking;
  services?: BookingServiceItem[];
}

export interface CreateBookingResponse extends APIResponse<Booking | CreateBookingData> {}

export interface BookingConflictResponse {
  success: false;
  message: string;
  data?: {
    conflictType?: string;
    existingBooking?: Booking;
    existingSession?: Session;
    reservedSlots?: AvailableSlot[];
  };
}

export interface GetMyBookingsResponse extends PaginatedResponse<Booking> {
  count?: number;
}

export interface CheckInBookingResponse
  extends APIResponse<{
    booking: Booking;
    session: Session;
  }> {}

export interface CheckOutBookingResponse
  extends APIResponse<{
    booking: Booking;
    session: Session;
    actualHours: number;
    refundHours: number;
    refundAmount: number;
    walletBalance?: number;
  }> {}

export interface ModifyBookingTimeRequest {
  newStart: string;
  newEnd: string;
}

export interface BookingMutationResponse extends APIResponse<Booking> {}

export interface ServicesResponse extends APIResponse<Service[]> {
  count?: number;
}
