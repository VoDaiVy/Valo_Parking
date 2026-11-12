import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/hooks/useAuth';
import bookingService from '@/services/BookingService';
import parkingFloorService from '@/services/ParkingFloorService';
import serviceService from '@/services/ServiceService';
import { walletService } from '@/services/api/wallet';
import type {
  BookingMembershipPolicy,
  CreateBookingRequest,
  ModifyBookingTimeRequest,
} from '@/types/api.types';
import type {
  AvailableSlot,
  Booking,
  BookingStatus,
  ParkingFloor,
  Service,
  SlotStatus,
} from '@/types/booking.types';
import type { BookingChangedEvent, SlotStatusChangedEvent } from '@/types/socket.types';

type BookingFilter = BookingStatus | 'all';

interface BookingContextValue {
  bookings: Booking[];
  availableSlots: AvailableSlot[];
  bookingPolicy: BookingMembershipPolicy | null;
  parkingFloors: ParkingFloor[];
  services: Service[];
  filterStatus: BookingFilter;
  isLoading: boolean;
  error: string;
  walletBalance: number;
  fetchBookings: () => Promise<void>;
  getAvailableSlots: (
    startTime: Date,
    endTime: Date,
    options?: { silent?: boolean },
  ) => Promise<void>;
  createBooking: (data: CreateBookingRequest) => Promise<Booking>;
  checkInBooking: (bookingId: string) => Promise<void>;
  checkOutBooking: (bookingId: string) => Promise<void>;
  cancelBooking: (bookingId: string) => Promise<void>;
  extendBooking: (bookingId: string, data: ModifyBookingTimeRequest) => Promise<void>;
  updateBookingVehicle: (bookingId: string, vehicleId: string) => Promise<void>;
  getBookingById: (bookingId: string) => Booking | undefined;
  fetchParkingFloors: () => Promise<void>;
  fetchServices: () => Promise<void>;
  fetchWalletBalance: () => Promise<void>;
  setFilterStatus: (status: BookingFilter) => void;
  updateSlotStatus: (floorId: string, slotCode: string, status: SlotStatus) => void;
}

export const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export const BookingProvider = ({ children }: { children: ReactNode }) => {
  const socket = useSocket();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [bookingPolicy, setBookingPolicy] = useState<BookingMembershipPolicy | null>(null);
  const [parkingFloors, setParkingFloors] = useState<ParkingFloor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [filterStatus, setFilterStatus] = useState<BookingFilter>('all');
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setBookings([]); setAvailableSlots([]); setBookingPolicy(null); setWalletBalance(0); setError('');
  }, [user?.id]);

  const fetchBookings = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await bookingService.getMyBookings();
      setBookings(bookingService.normalizeBookings(response));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load bookings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAvailableSlots = useCallback(async (
    startTime: Date,
    endTime: Date,
    options: { silent?: boolean } = {},
  ) => {
    if (!options.silent) {
      setIsLoading(true);
      setError('');
      setBookingPolicy(null);
    }
    try {
      const response = await bookingService.getAvailableSlots(startTime, endTime);
      setAvailableSlots(bookingService.normalizeAvailableSlots(response));
      setBookingPolicy(bookingService.normalizeBookingPolicy(response));
    } catch (fetchError) {
      if (!options.silent) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load slots.');
        setAvailableSlots([]);
        setBookingPolicy(null);
      }
    } finally {
      if (!options.silent) setIsLoading(false);
    }
  }, []);

  const fetchParkingFloors = useCallback(async () => {
    setError('');
    try {
      setParkingFloors(await parkingFloorService.getParkingFloors());
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load parking floors.');
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      setServices(await serviceService.getActiveServices());
    } catch (fetchError) {
      if (__DEV__) {
        console.warn('[Booking] services failed:', fetchError);
      }
      setServices([]);
    }
  }, []);

  const fetchWalletBalance = useCallback(async () => {
    const response = await walletService.getWallet();
    setWalletBalance(Number(response.data?.balance || 0));
  }, []);

  const createBooking = useCallback(
    async (data: CreateBookingRequest) => {
      setIsLoading(true);
      setError('');
      try {
        const response = await bookingService.createBooking(data);
        const booking = bookingService.normalizeBookingResponse(response);

        if (!booking) {
          throw new Error('Booking response was empty.');
        }

        setBookings((current) => [booking, ...current]);
        await fetchWalletBalance();

        return booking;
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Unable to create booking.');
        throw createError;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchWalletBalance],
  );

  const checkInBooking = useCallback(async (bookingId: string) => {
    setIsLoading(true);
    try {
      const response = await bookingService.checkInBooking(bookingId);
      const updated = bookingService.normalizeBooking(response.data?.booking);
      if (updated) {
        setBookings((current) => current.map((item) => (item._id === bookingId ? updated : item)));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkOutBooking = useCallback(
    async (bookingId: string) => {
      setIsLoading(true);
      try {
        const response = await bookingService.checkOutBooking(bookingId);
        const updated = bookingService.normalizeBooking(response.data?.booking);
        if (updated) {
          setBookings((current) => current.map((item) => (item._id === bookingId ? updated : item)));
        }
        await fetchWalletBalance();
      } finally {
        setIsLoading(false);
      }
    },
    [fetchWalletBalance],
  );

  const cancelBooking = useCallback(
    async (bookingId: string) => {
      setIsLoading(true);
      setError('');
      try {
        const response = await bookingService.cancelBooking(bookingId);
        const updated = bookingService.normalizeBooking(response.data);
        if (!updated) throw new Error('Booking response was empty.');

        setBookings((current) => current.map((item) => (item._id === bookingId ? updated : item)));
        await fetchWalletBalance();
      } catch (cancelError) {
        setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel booking.');
        throw cancelError;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchWalletBalance],
  );

  const extendBooking = useCallback(
    async (bookingId: string, data: ModifyBookingTimeRequest) => {
      setIsLoading(true);
      setError('');
      try {
        const response = await bookingService.extendBooking(bookingId, data);
        const updated = bookingService.normalizeBooking(response.data);
        if (!updated) throw new Error('Booking response was empty.');

        setBookings((current) => current.map((item) => (item._id === bookingId ? updated : item)));
        await fetchWalletBalance();
      } catch (extendError) {
        setError(extendError instanceof Error ? extendError.message : 'Unable to extend booking.');
        throw extendError;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchWalletBalance],
  );

  const updateBookingVehicle = useCallback(async (bookingId: string, vehicleId: string) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await bookingService.updateBookingVehicle(bookingId, vehicleId);
      const updated = bookingService.normalizeBooking(response.data);
      if (!updated) throw new Error('Booking response was empty.');

      setBookings((current) => current.map((item) => (item._id === bookingId ? updated : item)));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update booking vehicle.');
      throw updateError;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getBookingById = useCallback(
    (bookingId: string) => bookings.find((booking) => booking._id === bookingId),
    [bookings],
  );

  const updateSlotStatus = useCallback((floorId: string, slotCode: string, status: SlotStatus) => {
    setAvailableSlots((current) =>
      current.map((slot) =>
        slot.floorId === floorId && slot.slotCode === slotCode ? { ...slot, status } : slot,
      ),
    );
  }, []);

  useEffect(() => {
    const bookingHandler = (payload: unknown) => {
      const event = payload as BookingChangedEvent;
      setBookings((current) =>
        current.map((booking) => {
          if (booking._id !== event.bookingId) return booking;

          const update =
            event.booking && typeof event.booking === 'object'
              ? (event.booking as Record<string, unknown>)
              : {};
          return bookingService.normalizeBooking({ ...booking, ...update, status: event.status }) ?? booking;
        }),
      );
    };
    const slotHandler = (payload: unknown) => {
      const event = payload as SlotStatusChangedEvent;
      updateSlotStatus(event.floorId, event.slotCode, event.status);
    };

    socket.on('booking:changed', bookingHandler);
    socket.on('slot:status_changed', slotHandler);

    return () => {
      socket.off('booking:changed', bookingHandler);
      socket.off('slot:status_changed', slotHandler);
    };
  }, [socket, updateSlotStatus]);

  const value = useMemo<BookingContextValue>(
    () => ({
      bookings,
      availableSlots,
      bookingPolicy,
      parkingFloors,
      services,
      filterStatus,
      isLoading,
      error,
      walletBalance,
      fetchBookings,
      getAvailableSlots,
      createBooking,
      checkInBooking,
      checkOutBooking,
      cancelBooking,
      extendBooking,
      updateBookingVehicle,
      getBookingById,
      fetchParkingFloors,
      fetchServices,
      fetchWalletBalance,
      setFilterStatus,
      updateSlotStatus,
    }),
    [
      bookings,
      availableSlots,
      bookingPolicy,
      parkingFloors,
      services,
      filterStatus,
      isLoading,
      error,
      walletBalance,
      fetchBookings,
      getAvailableSlots,
      createBooking,
      checkInBooking,
      checkOutBooking,
      cancelBooking,
      extendBooking,
      updateBookingVehicle,
      getBookingById,
      fetchParkingFloors,
      fetchServices,
      fetchWalletBalance,
      updateSlotStatus,
    ],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};
