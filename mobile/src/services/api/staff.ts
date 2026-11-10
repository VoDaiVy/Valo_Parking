import type { APIResponse } from '@/types/api';

import { apiClient } from './client';

export interface StaffCustomerProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phone?: string;
  avatar?: string;
}

export interface StaffCustomer {
  _id: string;
  username?: string;
  email: string;
  role?: 'customer';
  status?: boolean;
  createdAt?: string;
  updatedAt?: string;
  profile?: StaffCustomerProfile;
}

export interface StaffBooking {
  _id: string;
  licensePlate: string;
  parkingSlot: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  prepaidAmount?: number;
  paymentMethod?: string;
  createdAt?: string;
  updatedAt?: string;
  userId?: { _id?: string; fullName?: string; email?: string; phone?: string };
  vehicleId?: { licensePlate?: string; brand?: string; color?: string };
  floorId?: { _id?: string; name?: string; floorNumber?: number } | string;
}

export type StaffBookingQrAction = 'CHECK_IN' | 'CHECK_OUT';

export interface StaffBookingQrResolution {
  booking: StaffBooking;
  allowedActions: StaffBookingQrAction[];
}

export interface StaffParkingPassResolution {
  credentialType: 'PARKING_PASS';
  pass: { _id: string };
  booking: StaffBooking | null;
  session: StaffSession | null;
  licensePlate: string;
  allowedActions: StaffBookingQrAction[];
}
export interface ParkingCheckoutQuote {
  totalPrice: number;
  amountToPay: number;
  canAutoPay?: boolean;
  walletBalance?: number;
  isEarlyExit?: boolean;
  remainingHours?: number;
  refundAmount?: number;
}
export interface ParkingPassTransitionResult {
  success: boolean;
  requiresPayment?: boolean;
  data?: { orderCode?: number; qrCode?: string; checkoutUrl?: string; checkoutAttemptId?: string };
}

export interface StaffBookingTransitionPayload {
  action: StaffBookingQrAction;
  payload: string;
  evidenceImageBase64: string;
  idempotencyKey: string;
  reason: string;
}

export interface StaffSubscription {
  _id: string;
  amount: number;
  paymentStatus: string;
  status: string;
  validFrom: string;
  expireAt: string;
  user?: { _id?: string; username?: string; email?: string; status?: string; vehicles?: string[] };
  ticketPackage?: { _id?: string; name?: string; type?: string; price?: number };
  slots?: Array<{
    entitlementId?: string;
    sourceSubscriptionId?: string;
    floorId?: { _id?: string; name?: string; floorNumber?: number } | string;
    slotCode: string;
    status?: string;
    expireAt?: string;
  }>;
}

export interface StaffMembershipVehicle {
  _id: string;
  licensePlate: string;
  vehicleType?: string;
  brand?: string;
  model?: string;
  color?: string;
}

export interface StaffMembershipQrResolution {
  credentialType: 'MEMBERSHIP';
  membership: StaffSubscription;
  vehicles: StaffMembershipVehicle[];
  activeSessions: StaffSession[];
  allowedActions: StaffBookingQrAction[];
}

export interface StaffMembershipTransitionPayload extends StaffBookingTransitionPayload {
  entitlementId?: string;
  vehicleId?: string;
  floorId?: string;
  parkingSlot?: string;
  sessionId?: string;
}

export interface TicketPackage {
  _id: string;
  name: string;
  type: 'hourly' | 'daily' | 'monthly' | 'yearly';
  price: number;
  description?: string;
  isActive: boolean;
  createdAt?: string;
}

export interface StaffSession {
  _id: string;
  type?: 'WALK_IN' | 'BOOKING' | 'SUBSCRIPTION';
  licensePlate: string;
  parkingSlot?: string;
  floorId?: string | { _id?: string; name?: string; floorNumber?: number };
  checkInTime: string;
  checkOutTime?: string;
  status: 'active' | 'completed' | 'cancelled';
  phone?: string;
  userId?: string;
  vehicleType?: string;
  source?: 'kiosk' | 'app_booking' | 'booking' | 'walk_in' | 'staff_manual';
  totalPrice?: number;
  paymentStatus?: string;
  expectedDurationHours?: number;
  entryImage_url?: string;
  exitImage_url?: string;
  entryCamera?: string;
  exitCamera?: string;
  entryGate?: string;
  exitGate?: string;
}

export const staffService = {
  resolveParkingPass: (payload: string) => apiClient.post<APIResponse<StaffParkingPassResolution>>('/parking-passes/resolve', { payload }),
  transitionParkingPass: (id: string, data: StaffBookingTransitionPayload & { paymentMethod?: string; checkoutAttemptId?: string; keepPaused?: boolean }) => apiClient.post<ParkingPassTransitionResult>(`/parking-passes/${id}/transition`, data),
  quoteParkingPass: (id: string, payload: string) => apiClient.post<APIResponse<ParkingCheckoutQuote>>(`/parking-passes/${id}/checkout-quote`, { payload }),
  checkParkingPayment: (orderCode: number, checkoutAttemptId: string) => apiClient.get<{ success: boolean; isPaid: boolean }>(`/sessions/check-payos/${orderCode}`, { params: { checkoutAttemptId } }),
  getCustomers: () => apiClient.get<APIResponse<StaffCustomer[]>>('/staff/users'),
  updateCustomerStatus: (id: string, status: boolean) =>
    apiClient.put<APIResponse<StaffCustomer>>(`/staff/users/${id}/status`, { status }),
  updateCustomer: (id: string, data: StaffCustomerProfile) =>
    apiClient.put<APIResponse<StaffCustomer>>(`/staff/users/${id}`, data),
  getBookings: (params?: { date?: string; floorId?: string }) =>
    apiClient.get<APIResponse<StaffBooking[]>>('/bookings/all', { params }),
  resolveBookingQr: (payload: string) =>
    apiClient.post<APIResponse<StaffBookingQrResolution>>('/staff/bookings/qr/resolve', { payload }),
  transitionBookingByQr: (bookingId: string, data: StaffBookingTransitionPayload) =>
    apiClient.post<APIResponse<{ booking: StaffBooking }>>(
      `/staff/bookings/${bookingId}/transition`,
      data,
    ),
  resolveMembershipQr: (payload: string) =>
    apiClient.post<APIResponse<StaffMembershipQrResolution>>(
      '/staff/memberships/qr/resolve',
      { payload },
    ),
  transitionMembershipByQr: (credentialId: string, data: StaffMembershipTransitionPayload) =>
    apiClient.post<APIResponse<{ session: StaffSession }>>(
      `/staff/memberships/${credentialId}/transition`,
      data,
    ),
  getSubscriptions: () => apiClient.get<APIResponse<StaffSubscription[]>>('/subscriptions/all'),
  getTicketPackages: () => apiClient.get<APIResponse<TicketPackage[]>>('/ticket-packages'),
  getSessions: () => apiClient.get<APIResponse<StaffSession[]>>('/sessions'),
};
