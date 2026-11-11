import { apiClient } from '@/services/api/client';
import type { APIResponse } from '@/types/api';
import type {
  AvailableSlotsData,
  BookingHoldResponse,
  BookingMutationResponse,
  BulkBookingItem,
  BulkBookingQuoteResponse,
  BulkBookingResponse,
  CheckInBookingResponse,
  CheckOutBookingResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  GetAvailableSlotsResponse,
  GetMyBookingsResponse,
  ModifyBookingTimeRequest,
} from '@/types/api.types';
import type {
  AvailableSlot,
  Booking,
  BookingServiceItem,
  BookingStatus,
  PaymentStatus,
} from '@/types/booking.types';

type UnknownRecord = Record<string, unknown>;

export interface BookingQrData {
  available: boolean;
  bookingStatus: string;
  payload: string | null;
  reason: string | null;
}

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const firstString = (record: UnknownRecord, keys: string[], fallback = '') => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
  }
  return fallback;
};

const firstNumber = (record: UnknownRecord, keys: string[], fallback = 0) => {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
};

const normalizeStatus = (value: unknown): BookingStatus => {
  const status = typeof value === 'string' ? value.toUpperCase() : '';
  const statuses: Record<string, BookingStatus> = {
    PENDING: 'pending',
    PAID: 'confirmed',
    CONFIRMED: 'confirmed',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
  };
  return statuses[status] ?? 'pending';
};

const normalizePaymentStatus = (value: unknown, status: BookingStatus): PaymentStatus => {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (
      normalized === 'pending' ||
      normalized === 'paid' ||
      normalized === 'failed' ||
      normalized === 'refunded' ||
      normalized === 'partially_refunded'
    ) {
      return normalized;
    }
  }

  if (status === 'pending') return 'pending';
  if (status === 'cancelled') return 'refunded';
  if (status === 'expired') return 'failed';
  return 'paid';
};

const normalizeServices = (value: unknown): BookingServiceItem[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const service = asRecord(item);
    if (!service) return [];

    const name = firstString(service, ['name', 'serviceName']);
    if (!name) return [];

    return [{
      _id: firstString(service, ['_id']) || undefined,
      serviceId: firstString(service, ['serviceId']) || undefined,
      name,
      price: firstNumber(service, ['price']),
    }];
  });
};

class BookingService {
  getAvailableSlots(startTime: Date, endTime: Date) {
    return apiClient.get<GetAvailableSlotsResponse>('/bookings/available-slots', {
      params: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
    });
  }

  createBooking(data: CreateBookingRequest) {
    return apiClient.post<CreateBookingResponse>('/bookings', {
      vehicleId: data.vehicleId,
      floorId: data.floorId,
      parkingSlot: data.slotCode,
      scheduledStart: data.startTime,
      scheduledEnd: data.endTime,
      paymentMethod: data.paymentMethod ?? 'wallet',
      services: data.services ?? [],
    });
  }

  quoteBulkBooking(items: BulkBookingItem[]) {
    return apiClient.post<BulkBookingQuoteResponse>('/bookings/bulk/quote', { items });
  }

  createBookingHold(data: {
    floorId: string;
    slotCode: string;
    licensePlate: string;
    startTime: string;
    endTime: string;
  }) {
    return apiClient.post<BookingHoldResponse>('/bookings/hold', data);
  }

  releaseBookingHold(holdId: string) {
    return apiClient.delete<APIResponse>(`/bookings/holds/${holdId}`);
  }

  createBulkBooking(data: { idempotencyKey: string; items: BulkBookingItem[]; expectedTotal?: number }) {
    return apiClient.post<BulkBookingResponse>('/bookings/bulk', data);
  }

  getActiveSessions() {
    return apiClient.get<any>('/sessions/active-status');
  }

  getActiveHolds() {
    return apiClient.get<any>('/bookings/active-holds');
  }

  getMyBookings() {
    return apiClient.get<GetMyBookingsResponse>('/bookings/my');
  }

  getBookingQr(bookingId: string) {
    return apiClient.get<APIResponse<BookingQrData>>(`/bookings/${bookingId}/qr`);
  }

  getCancellationQuote(bookingId: string) {
    return apiClient.get<APIResponse<{
      bookingId: string;
      paidAmount: number;
      refundAmount: number;
    }>>(`/bookings/${bookingId}/cancel-quote`);
  }

  checkInBooking(bookingId: string) {
    return apiClient.post<CheckInBookingResponse>(`/bookings/${bookingId}/check-in`);
  }

  checkOutBooking(bookingId: string) {
    return apiClient.post<CheckOutBookingResponse>(`/bookings/${bookingId}/check-out`);
  }

  cancelBooking(bookingId: string) {
    return apiClient.post<BookingMutationResponse>(`/bookings/${bookingId}/cancel`);
  }

  extendBooking(bookingId: string, data: ModifyBookingTimeRequest) {
    return apiClient.put<BookingMutationResponse>(`/bookings/${bookingId}/time`, data);
  }

  updateBookingVehicle(bookingId: string, vehicleId: string) {
    return apiClient.put<BookingMutationResponse>(`/bookings/${bookingId}/vehicle`, { vehicleId });
  }

  normalizeBooking(raw: unknown, responseServices?: unknown): Booking | undefined {
    const record = asRecord(raw);
    if (!record) return undefined;

    const id = firstString(record, ['_id', 'id']);
    if (!id) return undefined;

    const status = normalizeStatus(record.status);
    const paidHours = firstNumber(record, ['paidHours', 'durationHours']);
    const prepaidAmount = firstNumber(record, ['prepaidAmount']);
    const services = normalizeServices(record.services ?? responseServices);
    const serviceAmount = firstNumber(
      record,
      ['serviceAmount'],
      services.reduce((total, service) => total + service.price, 0),
    );
    const floor = asRecord(record.floorId);
    const vehicle = asRecord(record.vehicle ?? record.vehicleId);
    const rawPaymentMethod = firstString(record, ['paymentMethod']);
    const paymentMethod = rawPaymentMethod === 'vietqr' ? 'vietqr' : 'wallet';

    return {
      _id: id,
      userId: firstString(record, ['userId']),
      floorId: floor ? (floor as unknown as Booking['floorId']) : firstString(record, ['floorId']),
      slotCode: firstString(record, ['slotCode', 'parkingSlot']),
      zoneName: firstString(record, ['zoneName']) || undefined,
      licensePlate: firstString(record, ['licensePlate']) || firstString(vehicle ?? {}, ['licensePlate']),
      vehicle: asRecord(record.vehicle) as Booking['vehicle'] | undefined,
      vehicleId: vehicle
        ? (vehicle as unknown as Booking['vehicleId'])
        : firstString(record, ['vehicleId']) || undefined,
      startTime: firstString(record, ['startTime', 'scheduledStart']),
      endTime: firstString(record, ['endTime', 'scheduledEnd']),
      status,
      paidHours,
      hourlyRate: firstNumber(
        record,
        ['hourlyRate'],
        paidHours > 0 ? Math.max(prepaidAmount - serviceAmount, 0) / paidHours : 0,
      ),
      prepaidAmount,
      serviceAmount,
      finalAmount: firstNumber(record, ['finalAmount', 'totalAmount'], prepaidAmount),
      refundAmount: firstNumber(record, ['refundAmount']) || undefined,
      totalAmount: firstNumber(record, ['totalAmount']) || undefined,
      paymentMethod,
      paymentStatus: normalizePaymentStatus(record.paymentStatus, status),
      modificationCount: firstNumber(record, ['modificationCount']),
      services: services.length > 0 ? services : undefined,
      sessionId: record.sessionId as Booking['sessionId'],
      createdAt: firstString(record, ['createdAt']),
      updatedAt: firstString(record, ['updatedAt']) || undefined,
    };
  }

  normalizeBookingResponse(response: CreateBookingResponse): Booking | undefined {
    const data = response.data;
    const dataRecord = asRecord(data);
    const rawBooking = dataRecord?.booking ?? data;
    return this.normalizeBooking(rawBooking, dataRecord?.services);
  }

  normalizeBookings(response: GetMyBookingsResponse | { data?: unknown }) {
    const directData = response.data;
    const nestedData = asRecord(directData)?.data;
    const bookings = Array.isArray(directData)
      ? directData
      : Array.isArray(nestedData)
        ? nestedData
        : [];

    return bookings.flatMap((booking) => {
      const normalized = this.normalizeBooking(booking);
      return normalized ? [normalized] : [];
    });
  }

  normalizeAvailableSlots(response: GetAvailableSlotsResponse | { data?: AvailableSlot[] | AvailableSlotsData }) {
    const data = response.data;

    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === 'object' && Array.isArray(data.slots)) {
      return data.slots;
    }

    return [];
  }

  normalizeBookingPolicy(response: GetAvailableSlotsResponse) {
    const data = response.data;
    return Array.isArray(data) ? null : data?.bookingPolicy ?? null;
  }
}

export const bookingService = new BookingService();
export default bookingService;
