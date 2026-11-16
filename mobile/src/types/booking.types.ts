import type { Vehicle } from './models';

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'expired';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type SlotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type SessionStatus = 'active' | 'completed' | 'cancelled';

export interface LayoutElement {
  id: string;
  type: 'slot' | 'zone' | 'lane' | 'entry' | 'exit' | 'wall' | 'label';
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  slotCode?: string;
  zoneName?: string;
  status?: SlotStatus;
}

export interface FloorLayoutData {
  width: number;
  height: number;
  elements: LayoutElement[];
}

export interface ParkingFloor {
  _id: string;
  id?: string;
  floorNumber: number;
  name: string;
  layout?: FloorLayoutData;
  layoutData?: any;
  slots?: Slot[];
}

export interface Slot {
  id: string;
  _id?: string;
  slotCode: string;
  code?: string;
  slotNumber?: string;
  zoneName?: string;
  floorId: string;
  floorID?: string;
  status: SlotStatus;
  reservedFor?: string | { _id?: string } | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface AvailableSlot extends Slot {
  floor?: ParkingFloor;
  floorName?: string;
  floorNumber?: number;
}

export interface Service {
  _id: string;
  id?: string;
  name: string;
  description?: string;
  price: number;
  estimatedTime?: number;
  estimatedTimeMinutes?: number;
  imageUrl?: string;
  image?: string;
  isActive?: boolean;
  status?: 'active' | 'inactive';
}

export interface BookingServiceItem {
  _id?: string;
  serviceId?: string;
  name: string;
  price: number;
}

export interface Session {
  _id: string;
  bookingId?: string;
  parkingSlot?: string;
  checkInTime: string;
  checkOutTime?: string;
  expectedDurationHours?: number;
  status: SessionStatus;
  totalPrice?: number;
  refundAmount?: number;
}

export interface Booking {
  _id: string;
  userId: string;
  floorId: ParkingFloor | string;
  slotCode: string;
  zoneName?: string;
  licensePlate: string;
  vehicle?: Vehicle;
  vehicleId?: string | Vehicle;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  paidHours: number;
  hourlyRate: number;
  prepaidAmount: number;
  serviceAmount: number;
  finalAmount: number;
  refundAmount?: number;
  totalAmount?: number;
  paymentMethod: 'wallet' | 'vietqr';
  paymentStatus: PaymentStatus;
  modificationCount?: number;
  services?: BookingServiceItem[];
  sessionId?: string | Session;
  createdAt: string;
  updatedAt?: string;
}

export const bookingStatuses: BookingStatus[] = [
  'pending',
  'confirmed',
  'active',
  'paused',
  'completed',
  'cancelled',
  'expired',
];
