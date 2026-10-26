import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { addMinutes, format } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import {
  BookingActionModal,
  type BookingModalVariant,
} from '@/components/booking/BookingActionModal';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useBooking } from '@/hooks/useBooking';
import type { BookingStackParamList } from '@/navigation/BookingStackNavigator';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import { vehiclesService } from '@/services/api/vehicles';
import { ParkingMap2D } from '@/components/booking/ParkingMap2D';
import bookingService from '@/services/BookingService';
import parkingFloorService from '@/services/ParkingFloorService';
import type { AvailableSlot, ParkingFloor, Service } from '@/types/booking.types';
import type { Vehicle } from '@/types/models';
import type { MembershipStatus } from '@/types/subscription.types';
import { formatCurrency } from '@/utils/formatters';
import { subscriptionsService } from '@/services/api/subscriptions';
import { loyaltyService } from '@/services/api/loyalty';
import { useBookingCart } from '@/contexts/BookingCartContext';
import { WorkflowChip, workflowStyles as workflow } from '@/components/common/WorkflowUI';
import type { UserVoucher } from '@/types/loyalty.types';
import * as Crypto from 'expo-crypto';
import { normalizeLicensePlate } from '@/utils/profileValidation';


type Props = NativeStackScreenProps<BookingStackParamList, 'CreateBooking'>;

interface CreateFeedback {
  variant: BookingModalVariant;
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const roundUpTo15Min = (date: Date) => {
  const ms = 1000 * 60 * 15;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
};

const getServiceId = (service: Service) => service._id || service.id || '';

// generate time slots every 15 minutes: ['00:00', '00:15', ...]
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

// ── Time Picker Modal ────────────────────────────────────────────────────────
type TimePickerModalProps = {
  visible: boolean;
  title: string;
  initialDate: Date;
  minDate?: Date;
  onConfirm: (date: Date) => void;
  onClose: () => void;
};

function TimePickerModal({ visible, title, initialDate, minDate, onConfirm, onClose }: TimePickerModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(() => format(initialDate, 'HH:mm'));
  const [dateText, setDateText] = useState(() => format(initialDate, 'yyyy-MM-dd'));
  const dateOptions = useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const day = new Date(minDate || new Date());
    day.setDate(day.getDate() + index); day.setHours(0, 0, 0, 0); return day;
  }), [visible, minDate?.getDate(), minDate?.getMonth()]);

  useEffect(() => {
    if (visible) {
      setSelectedDate(initialDate);
      setSelectedTime(format(initialDate, 'HH:mm'));
      setDateText(format(initialDate, 'yyyy-MM-dd'));
    }
  }, [visible, initialDate]);

  const minDateStr = minDate ? format(minDate, 'yyyy-MM-dd') : null;
  const minTimeStr = minDate && format(selectedDate, 'yyyy-MM-dd') === format(minDate, 'yyyy-MM-dd')
    ? format(minDate, 'HH:mm')
    : null;

  const handleConfirm = () => {
    const [h, m] = selectedTime.split(':').map(Number);
    const result = new Date(selectedDate);
    result.setHours(h, m, 0, 0);
    onConfirm(result);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={mpStyles.overlay}>
        <View style={mpStyles.sheet}>
          <View style={mpStyles.header}>
            <Text style={mpStyles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Date selection */}
          <Text style={mpStyles.label}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={mpStyles.dateRow}>
            {dateOptions.map((date) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const active = format(selectedDate, 'yyyy-MM-dd') === dateStr;
              const disabled = minDateStr ? dateStr < minDateStr : false;
              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[mpStyles.datePill, active && mpStyles.datePillActive, disabled && mpStyles.datePillDisabled]}
                  onPress={() => { if (!disabled) { setSelectedDate(date); setDateText(dateStr); } }}
                  disabled={disabled}
                >
                  <Text style={[mpStyles.datePillDay, active && mpStyles.datePillTextActive, disabled && mpStyles.datePillTextDisabled]}>
                    {format(date, 'EEE').toUpperCase()}
                  </Text>
                  <Text style={[mpStyles.datePillDate, active && mpStyles.datePillTextActive, disabled && mpStyles.datePillTextDisabled]}>
                    {format(date, 'dd/MM')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={mpStyles.label}>Or enter a date (YYYY-MM-DD)</Text>
          <TextInput accessibilityLabel="Booking date" placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textMuted} style={workflow.input} value={dateText} onChangeText={(value) => {
            setDateText(value);
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
              const day = new Date(`${value}T00:00:00`);
              if (Number.isFinite(day.getTime()) && format(day, 'yyyy-MM-dd') === value) setSelectedDate(day);
            }
          }} />

          {/* Time selection */}
          <Text style={mpStyles.label}>Time</Text>
          <ScrollView style={mpStyles.timeList} showsVerticalScrollIndicator={false}>
            <View style={mpStyles.timeGrid}>
              {TIME_OPTIONS.map((time) => {
                const active = selectedTime === time;
                const disabled = minTimeStr ? time < minTimeStr : false;
                return (
                  <TouchableOpacity
                    key={time}
                    style={[mpStyles.timePill, active && mpStyles.timePillActive, disabled && mpStyles.timePillDisabled]}
                    onPress={() => !disabled && setSelectedTime(time)}
                    disabled={disabled}
                  >
                    <Text style={[mpStyles.timePillText, active && mpStyles.timePillTextActive, disabled && mpStyles.timePillTextDisabled]}>
                      {time}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity disabled={dateText !== format(selectedDate, 'yyyy-MM-dd') || Boolean(minDateStr && dateText < minDateStr) || Boolean(minTimeStr && selectedTime < minTimeStr)} style={mpStyles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <LinearGradient
              colors={[COLORS.goldLight, COLORS.gold, COLORS.goldDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={mpStyles.confirmGrad}
            >
              <Text style={mpStyles.confirmText}>Confirm</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const mpStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
    maxHeight: '80%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.md },
  title: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '700', marginBottom: SPACING.sm, marginTop: SPACING.md, textTransform: 'uppercase', letterSpacing: 1 },
  dateRow: { gap: SPACING.sm, paddingBottom: SPACING.sm },
  datePill: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 60,
  },
  datePillActive: { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: COLORS.gold },
  datePillDisabled: { opacity: 0.35 },
  datePillDay: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  datePillDate: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600', marginTop: 2 },
  datePillTextActive: { color: COLORS.gold },
  datePillTextDisabled: { color: COLORS.textMuted },
  timeList: { maxHeight: 200 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  timePill: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
    minWidth: 60,
    alignItems: 'center',
  },
  timePillActive: { backgroundColor: 'rgba(212,175,55,0.15)', borderColor: COLORS.gold },
  timePillDisabled: { opacity: 0.3 },
  timePillText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  timePillTextActive: { color: COLORS.gold, fontWeight: '700' },
  timePillTextDisabled: { color: COLORS.textMuted },
  confirmBtn: { marginTop: SPACING.lg, borderRadius: RADIUS.md, overflow: 'hidden' },
  confirmGrad: { height: 50, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '700' },
});

const STICKY_FOOTER_SPACE = 178;

const useEntrance = (delay = 0) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      delay,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);

  return progress;
};

function AnimatedPressable({
  children,
  disabled,
  onPress,
  style,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style?: object;
}) {
  const press = useRef(new Animated.Value(0)).current;

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 15,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.975],
  });

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function StaggeredSection({
  children,
  delay,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  style?: object;
}) {
  const entrance = useEntrance(delay);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function TimeTimeline({
  startTime,
  endTime,
  durationHours,
  onStartPress,
  onEndPress,
}: {
  startTime: Date;
  endTime: Date;
  durationHours: number;
  onStartPress: () => void;
  onEndPress: () => void;
}) {
  return (
    <StaggeredSection delay={110} style={styles.section}>
      <Text style={styles.sectionKicker}>Time</Text>
      <View style={styles.timeline}>
        <AnimatedPressable onPress={onStartPress} style={styles.timeBlock}>
          <View style={styles.timeLabelRow}>
            <Ionicons name="log-in-outline" size={16} color={COLORS.gold} />
            <Text style={styles.timeLabel}>Arrival</Text>
          </View>
          <Text style={styles.timeValue}>{format(startTime, 'HH:mm')}</Text>
          <Text style={styles.timeDate}>{format(startTime, 'dd MMM yyyy')}</Text>
        </AnimatedPressable>

        <View style={styles.timelineMiddle}>
          <View style={styles.timelineLine} />
          <View style={styles.durationChip}>
            <Ionicons name="time-outline" size={13} color={COLORS.gold} />
            <Text style={styles.durationText}>{durationHours}h</Text>
          </View>
        </View>

        <AnimatedPressable onPress={onEndPress} style={styles.timeBlock}>
          <View style={styles.timeLabelRow}>
            <Ionicons name="log-out-outline" size={16} color={COLORS.staffBlue} />
            <Text style={styles.timeLabel}>Departure</Text>
          </View>
          <Text style={styles.timeValue}>{format(endTime, 'HH:mm')}</Text>
          <Text style={styles.timeDate}>{format(endTime, 'dd MMM yyyy')}</Text>
        </AnimatedPressable>
      </View>
    </StaggeredSection>
  );
}

function VehicleSelector({
  vehicleError,
  vehicles,
  selectedVehicleId,
  manualPlate,
  membershipBlocksRegisteredVehicle,
  onRetry,
  onSelectVehicle,
  onManualPlateChange,
  onManageVehicles,
}: {
  vehicleError: string;
  vehicles: Vehicle[];
  selectedVehicleId: string | null;
  manualPlate: string;
  membershipBlocksRegisteredVehicle: boolean;
  onRetry: () => void;
  onSelectVehicle: (id: string) => void;
  onManualPlateChange: (value: string) => void;
  onManageVehicles: () => void;
}) {
  return (
    <StaggeredSection delay={180} style={styles.section}>
      <Text style={styles.sectionKicker}>Your vehicle</Text>
      {vehicleError ? (
        <ErrorState message={vehicleError} onRetry={onRetry} />
      ) : vehicles.length === 0 ? (
        <View style={styles.vehicleEmpty}>
          <View style={styles.vehicleEmptyIcon}>
            <Ionicons name="car-outline" size={22} color={COLORS.gold} />
          </View>
          <View style={styles.vehicleEmptyCopy}>
            <Text style={styles.vehicleEmptyTitle}>No approved vehicle</Text>
            <Text style={styles.vehicleEmptyText}>Add a vehicle or wait for approval in your profile before booking.</Text>
          </View>
          <Pressable style={styles.manageVehicleBtn} onPress={onManageVehicles}>
            <Text style={styles.manageVehicleText}>Manage vehicles</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          {vehicles.map((vehicle) => {
            const vehicleId = vehicle.id ?? vehicle._id ?? '';
            const active = selectedVehicleId === vehicleId;
            return (
              <Pressable
                accessibilityLabel={`Select vehicle ${vehicle.licensePlate}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={vehicleId}
                style={[styles.vehiclePill, active && styles.vehiclePillActive]}
                onPress={() => onSelectVehicle(vehicleId)}
              >
                <Ionicons name={active ? 'car-sport' : 'car-outline'} size={17} color={active ? COLORS.gold : COLORS.textMuted} />
                <Text style={[styles.vehicleText, active && styles.vehicleTextActive]}>{vehicle.licensePlate}</Text>
                {active ? <Ionicons name="checkmark-circle" size={15} color={COLORS.gold} /> : null}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityLabel="Use another license plate"
            accessibilityRole="radio"
            accessibilityState={{ checked: selectedVehicleId === 'manual' }}
            style={[styles.vehiclePill, selectedVehicleId === 'manual' && styles.vehiclePillActive]}
            onPress={() => onSelectVehicle('manual')}
          >
            <Ionicons name="create-outline" size={17} color={selectedVehicleId === 'manual' ? COLORS.gold : COLORS.textMuted} />
            <Text style={[styles.vehicleText, selectedVehicleId === 'manual' && styles.vehicleTextActive]}>Other plate</Text>
          </Pressable>
        </ScrollView>
      )}

      {vehicles.length === 0 && !vehicleError ? <WorkflowChip selected={selectedVehicleId === 'manual'} onPress={() => onSelectVehicle('manual')}>Enter another license plate</WorkflowChip> : null}

      {selectedVehicleId === 'manual' ? (
        <View style={styles.manualInputWrap}>
          <TextInput
            autoCapitalize="characters"
            placeholder="Enter license plate (e.g. 30A-12345)"
            placeholderTextColor={COLORS.textMuted}
            style={styles.manualInput}
            value={manualPlate}
            onChangeText={onManualPlateChange}
          />
        </View>
      ) : null}

      {membershipBlocksRegisteredVehicle ? (
        <View style={styles.warningBox}>
          <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
          <Text style={styles.warningText}>
            Your membership has an available VIP space. Assign a vehicle to it before booking a regular space.
          </Text>
        </View>
      ) : null}
    </StaggeredSection>
  );
}

function ParkingLegend() {
  const items = [
    { label: 'Available', color: '#7EE8A2' },
    { label: 'Occupied', color: '#FF6B6B' },
    { label: 'VIP', color: '#FFD700' },
    { label: 'Reserved', color: '#FFA500' },
    { label: 'Maintenance', color: '#A0A0A0' },
  ];

  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function ParkingMapSection({
  selectedSlot,
  selectedVehiclePlate,
  selectedFloorName,
  selectedRouteSlotUnavailable,
  selectedSlotCode,
  parkingFloors,
  selectedFloor,
  availableSlots,
  isLoading,
  dbSlots,
  error,
  activeSessions,
  activeHolds,
  startTime,
  endTime,
  onClearSlot,
  onSelectFloor,
  onSelectSlot,
  onRetryFloors,
  onRetrySlots,
}: {
  selectedSlot: AvailableSlot | null;
  selectedVehiclePlate?: string;
  selectedFloorName?: string;
  selectedRouteSlotUnavailable: boolean;
  selectedSlotCode?: string;
  parkingFloors: ParkingFloor[];
  selectedFloor: ParkingFloor | null;
  availableSlots: AvailableSlot[];
  isLoading: boolean;
  dbSlots: any[] | null;
  error?: string | null;
  activeSessions: any[];
  activeHolds: any[];
  startTime: Date;
  endTime: Date;
  onClearSlot: () => void;
  onSelectFloor: (floor: ParkingFloor) => void;
  onSelectSlot: (slot: AvailableSlot | null) => void;
  onRetryFloors: () => void;
  onRetrySlots: (start: Date, end: Date) => void;
}) {
  const selectedFloorId = selectedFloor?._id ?? selectedFloor?.id ?? String(selectedFloor?.floorNumber ?? '');
  const floorAvailableCount = selectedFloor
    ? availableSlots.filter((slot) => slot.floorId === selectedFloorId).length
    : availableSlots.length;

  return (
    <StaggeredSection delay={260} style={styles.mapSection}>
      <View style={styles.mapHeader}>
        <View>
          <Text style={styles.sectionKicker}>Parking space</Text>
          <Text style={styles.mapTitle}>{selectedFloor?.name ?? 'Choose a floor'}</Text>
        </View>
        <View style={styles.availableBadge}>
          <Text style={styles.availableCount}>{floorAvailableCount}</Text>
          <Text style={styles.availableLabel}>available</Text>
        </View>
      </View>

      {selectedSlot ? (
        <View style={styles.selectedSlotCard}>
          <View style={styles.selectedSlotIcon}>
            <Ionicons name="location" size={20} color={COLORS.gold} />
          </View>
          <View style={styles.selectedSlotInfo}>
            <Text style={styles.selectedSlotCode}>{selectedSlot.slotCode}</Text>
            <Text style={styles.selectedSlotMeta}>
              {selectedSlot.floorName ?? selectedFloorName ?? selectedSlot.floorId}
              {selectedVehiclePlate ? ` · ${selectedVehiclePlate}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Clear selected space"
            accessibilityRole="button"
            style={styles.clearSlotBtn}
            onPress={onClearSlot}
          >
            <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
          </Pressable>
        </View>
      ) : selectedRouteSlotUnavailable ? (
        <View style={styles.warningBox}>
          <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
          <Text style={styles.warningText}>
            Space {selectedSlotCode} is no longer available. Please choose another space.
          </Text>
        </View>
      ) : null}

      {parkingFloors.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.floorTabs}>
          {parkingFloors.map((floor) => {
            const floorId = floor._id ?? floor.id ?? String(floor.floorNumber);
            const active = selectedFloor && (selectedFloor._id ?? selectedFloor.id ?? String(selectedFloor.floorNumber)) === floorId;
            const floorCount = availableSlots.filter((slot) => slot.floorId === floorId).length;
            return (
              <Pressable
                key={floorId}
                style={[styles.floorTab, active && styles.floorTabActive]}
                onPress={() => onSelectFloor(floor)}
              >
                <Text style={[styles.floorTabText, active && styles.floorTabTextActive]}>{floor.name}</Text>
                <View style={[styles.floorCount, active && styles.floorCountActive]}>
                  <Text style={[styles.floorCountText, active && styles.floorCountTextActive]}>{floorCount}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ParkingLegend />

      <View style={styles.mapCanvas}>
        {isLoading || dbSlots === null ? (
          <View style={styles.mapState}>
            <ActivityIndicator color={COLORS.gold} size="large" />
            <Text style={styles.mapStateText}>Loading parking map...</Text>
          </View>
        ) : error ? (
          <View style={styles.mapState}>
            <ErrorState
              message={error}
              onRetry={() => {
                onRetryFloors();
                onRetrySlots(startTime, endTime);
              }}
            />
          </View>
        ) : !selectedFloor ? (
          <View style={styles.mapState}>
            <EmptyState icon="layers-outline" title="No floors available" message="No parking floors were found." />
          </View>
        ) : (
          <ParkingMap2D
            activeHolds={activeHolds}
            activeSessions={activeSessions}
            dbSlots={dbSlots}
            floor={selectedFloor}
            floorSlots={availableSlots.filter(
              (slot) => slot.floorId === (selectedFloor._id ?? selectedFloor.id ?? String(selectedFloor.floorNumber)),
            )}
            selectedSlot={selectedSlot}
            onSelectSlot={onSelectSlot}
          />
        )}
      </View>
    </StaggeredSection>
  );
}

function ServiceList({
  services,
  selectedServiceIds,
  serviceTotal,
  onToggleService,
}: {
  services: Service[];
  selectedServiceIds: string[];
  serviceTotal: number;
  onToggleService: (serviceId: string) => void;
}) {
  return (
    <StaggeredSection delay={340} style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionKicker}>Additional services</Text>
        {serviceTotal > 0 ? <Text style={styles.serviceTotalBadge}>+{formatCurrency(serviceTotal)}</Text> : null}
      </View>

      {services.length === 0 ? (
        <View style={styles.emptyServices}>
          <Text style={styles.emptyServicesText}>No services are currently available.</Text>
        </View>
      ) : (
        <View style={styles.serviceList}>
          {services.map((service, index) => {
            const serviceId = getServiceId(service);
            const selected = selectedServiceIds.includes(serviceId);
            return (
              <Pressable
                accessibilityLabel={`${service.name}, ${formatCurrency(service.price)}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={serviceId}
                style={[styles.serviceItem, selected && styles.serviceItemActive]}
                onPress={() => onToggleService(serviceId)}
              >
                <View style={[styles.serviceCheckbox, selected && styles.serviceCheckboxActive]}>
                  {selected ? <Ionicons name="checkmark" size={14} color={COLORS.textInverse} /> : null}
                </View>
                <View style={styles.serviceInfo}>
                  <Text numberOfLines={2} style={styles.serviceName}>{service.name}</Text>
                  {service.description ? (
                    <Text numberOfLines={1} style={styles.serviceDescription}>{service.description}</Text>
                  ) : (service.estimatedTime || service.estimatedTimeMinutes) ? (
                    <Text style={styles.serviceDescription}>
                      {service.estimatedTime ?? service.estimatedTimeMinutes} min
                    </Text>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={styles.servicePrice}>{formatCurrency(service.price)}</Text>
                {index < services.length - 1 ? <View style={styles.serviceDivider} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </StaggeredSection>
  );
}

function PriceBreakdown({
  hourlyRate,
  paidHours,
  parkingCost,
  serviceTotal,
}: {
  hourlyRate: number;
  paidHours: number;
  parkingCost: number;
  serviceTotal: number;
}) {
  return (
    <StaggeredSection delay={420} style={styles.priceDetails}>
      <Text style={styles.sectionKicker}>Price details</Text>
      <View style={styles.priceLine}>
        <Text style={styles.priceLabel}>Hourly rate</Text>
        <Text style={styles.priceValue}>{formatCurrency(hourlyRate)}</Text>
      </View>
      <View style={styles.priceLine}>
        <Text style={styles.priceLabel}>Billable time</Text>
        <Text style={styles.priceValue}>{paidHours} hours</Text>
      </View>
      <View style={styles.priceLine}>
        <Text style={styles.priceLabel}>Parking fee</Text>
        <Text style={styles.priceValue}>{formatCurrency(parkingCost)}</Text>
      </View>
      <View style={styles.priceLine}>
        <Text style={styles.priceLabel}>Services</Text>
        <Text style={styles.priceValue}>{formatCurrency(serviceTotal)}</Text>
      </View>
    </StaggeredSection>
  );
}

function StickyBookingFooter({
  grandTotal,
  walletBalance,
  hasEnoughBalance,
  canBook,
  submitting,
  disabledReason,
  onSubmit,
  submitLabel,
}: {
  grandTotal: number;
  walletBalance: number;
  hasEnoughBalance: boolean;
  canBook: boolean;
  submitting: boolean;
  disabledReason: string;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const entrance = useEntrance(500);
  const press = useRef(new Animated.Value(0)).current;

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 15,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.985],
  });

  return (
    <Animated.View
      style={[
        styles.stickyFooter,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [36, 0],
              }),
            },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={['rgba(21,23,26,0.98)', 'rgba(11,12,14,0.96)']}
        style={StyleSheet.absoluteFill}
      />
      {!hasEnoughBalance ? (
        <View style={styles.footerWarning}>
          <Ionicons name="warning-outline" size={14} color={COLORS.warning} />
          <Text style={styles.footerWarningText}>
            Wallet balance {formatCurrency(walletBalance)} - insufficient
          </Text>
        </View>
      ) : !canBook && disabledReason ? (
        <View style={styles.footerWarning}>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.footerHintText}>{disabledReason}</Text>
        </View>
      ) : null}

      <View style={styles.footerMain}>
        <View style={styles.footerTotal}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalValue}>{formatCurrency(grandTotal)}</Text>
        </View>
        <Animated.View style={[styles.footerSubmitWrap, { transform: [{ scale }] }]}>
          <Pressable
            accessibilityLabel={submitLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canBook, busy: submitting }}
            disabled={!canBook}
            onPress={onSubmit}
            onPressIn={() => animatePress(1)}
            onPressOut={() => animatePress(0)}
          >
            <LinearGradient
              colors={canBook ? [COLORS.goldLight, COLORS.gold, COLORS.goldDark] : ['#393A3D', '#2B2D31']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={styles.footerSubmitGrad}
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.textInverse} size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={19} color={canBook ? COLORS.textInverse : COLORS.textMuted} />
                  <Text style={[styles.footerSubmitText, !canBook && styles.footerSubmitTextDisabled]}>
                    {submitLabel}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────
export const CreateBookingScreen = ({ navigation, route }: Props) => {
  const {
    availableSlots,
    parkingFloors,
    services,
    walletBalance,
    isLoading,
    error,
    fetchWalletBalance,
    fetchParkingFloors,
    fetchServices,
    getAvailableSlots,
  } = useBooking();

  // ── Time state ────────────────────────────────────────────────────────────
  const [startTime, setStartTime] = useState<Date>(() => roundUpTo15Min(new Date()));
  const [endTime, setEndTime] = useState<Date>(() => addMinutes(roundUpTo15Min(new Date()), 60));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // ── Data state ────────────────────────────────────────────────────────────
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleError, setVehicleError] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [manualPlate, setManualPlate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [hourlyRate, setHourlyRate] = useState(10000);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<CreateFeedback | null>(null);
  const [dbSlots, setDbSlots] = useState<any[] | null>(null);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [activeHolds, setActiveHolds] = useState<any[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<ParkingFloor | null>(null);
  const [serverQuoteTotal, setServerQuoteTotal] = useState<number | null>(null);
  const cart = useBookingCart();
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const [vouchers, setVouchers] = useState<UserVoucher[]>([]);
  const [voucherError, setVoucherError] = useState('');
  const [selectedVoucherId, setSelectedVoucherId] = useState(route.params?.selectedVoucherId || '');
  useEffect(() => {
    void loyaltyService.getVouchers('available').then((response) => setVouchers(response.data || []))
      .catch((e) => setVoucherError(e instanceof Error ? e.message : 'Unable to load vouchers.'));
  }, []);
  useEffect(() => { if (route.params?.selectedVoucherId) setSelectedVoucherId(route.params.selectedVoucherId); }, [route.params?.selectedVoucherId]);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);

  const selectedFloorId = route.params?.selectedFloorId;
  const selectedSlotCode = route.params?.selectedSlotCode;
  const selectedFloorName = route.params?.selectedFloorName;
  const selectedServiceId = route.params?.selectedServiceId;

  useEffect(() => {
    const start = new Date(route.params?.initialStartTime || '');
    const end = new Date(route.params?.initialEndTime || '');
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start > new Date() && end.getTime() - start.getTime() >= 30 * 60_000) {
      setStartTime(start); setEndTime(end);
    }
  }, [route.params?.initialStartTime, route.params?.initialEndTime]);

  const fetchExtraData = useCallback(async () => {
    try {
      const [sessionsRes, holdsRes] = await Promise.all([
        bookingService.getActiveSessions(),
        bookingService.getActiveHolds(),
      ]);
      setActiveSessions(sessionsRes.data || []);
      setActiveHolds(holdsRes.data || []);
    } catch (err) {
      console.warn('Failed to fetch extra map data:', err);
    }
  }, []);

  useEffect(() => {
    void fetchExtraData();
  }, [fetchExtraData]);

  useEffect(() => {
    const fetchSlots = async () => {
      if (!selectedFloor) return;
      setDbSlots(null);
      try {
        const floorId = selectedFloor._id ?? selectedFloor.id ?? String(selectedFloor.floorNumber);
        const slots = await parkingFloorService.getSlotsByFloor(floorId);
        setDbSlots(slots || []);
      } catch (err) {
        console.warn('Failed to fetch db slots:', err);
        setDbSlots([]);
      }
    };
    void fetchSlots();
  }, [selectedFloor]);

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadVehicles = useCallback(async () => {
    setVehicleError('');
    try {
      const res = await vehiclesService.getMyVehicles();
      const approved = (res.data ?? []).filter((v) => !v.status || v.status === 'approved');
      setVehicles(approved);
      const requestedPlate = route.params?.initialLicensePlate;
      const requested = requestedPlate ? approved.find((v) => normalizeLicensePlate(v.licensePlate) === normalizeLicensePlate(requestedPlate)) : null;
      const defaultVehicle = requested || approved.find((v) => v.isDefault) || approved[0];
      if (requestedPlate && !requested) {
        setSelectedVehicleId('manual'); setManualPlate(requestedPlate);
      } else setSelectedVehicleId(defaultVehicle?.id ?? defaultVehicle?._id ?? '');
    } catch (e: unknown) {
      setVehicleError(e instanceof Error ? e.message : 'Unable to load vehicles.');
    }
  }, [route.params?.initialLicensePlate]);

  const loadHourlyRate = useCallback(async () => {
    try {
      const res = await subscriptionsService.getPackages();
      const packages = (res as any)?.data ?? [];
      const hourlyPkg = packages.find((p: any) => p.type === 'hourly');
      if (hourlyPkg?.price) setHourlyRate(Number(hourlyPkg.price));
    } catch {
      // keep default 10000
    }
  }, []);

  const loadMembership = useCallback(async () => {
    try {
      const response = await subscriptionsService.getMembership();
      setMembership(response.data || null);
    } catch {
      setMembership(null);
    }
  }, []);

  useEffect(() => {
    void fetchWalletBalance().catch(() => undefined);
    void fetchParkingFloors();
    void fetchServices();
    void loadVehicles();
    void loadHourlyRate();
    void loadMembership();
  }, [fetchWalletBalance, fetchParkingFloors, fetchServices, loadVehicles, loadHourlyRate, loadMembership]);

  useEffect(() => {
    if (!selectedServiceId || services.length === 0) return;
    const matchedService = services.find((service) => getServiceId(service) === selectedServiceId);
    if (!matchedService) return;
    const matchedServiceId = getServiceId(matchedService);
    if (!matchedServiceId) return;
    setSelectedServiceIds((current) => (current.includes(matchedServiceId) ? current : [...current, matchedServiceId]));
  }, [selectedServiceId, services]);

  useEffect(() => {
    const now = new Date();
    if (startTime > now && endTime > startTime) {
      void getAvailableSlots(startTime, endTime);
    }
  }, [endTime, getAvailableSlots, startTime]);

  useEffect(() => {
    const refreshLiveBookingState = () => {
      void fetchExtraData();
      if (startTime > new Date() && endTime > startTime) {
        void getAvailableSlots(startTime, endTime, { silent: true });
      }
    };
    const intervalId = setInterval(refreshLiveBookingState, 15000);
    return () => clearInterval(intervalId);
  }, [endTime, fetchExtraData, getAvailableSlots, startTime]);

  useEffect(() => {
    if (parkingFloors.length > 0 && !selectedFloor) {
      const preferredFloor = route.params?.selectedFloorId
        ? parkingFloors.find((f) => String(f._id ?? f.id ?? f.floorNumber) === route.params?.selectedFloorId)
        : parkingFloors[0];
      setSelectedFloor(preferredFloor ?? parkingFloors[0]);
    }
  }, [parkingFloors, route.params?.selectedFloorId, selectedFloor]);

  useEffect(() => {
    if (!selectedFloorId || !selectedSlotCode || dbSlots === null) return;
    const dbSlot = dbSlots.find(
      (slot) => String(slot.slotNumber || '').toUpperCase() === selectedSlotCode.toUpperCase(),
    );
    const matched = availableSlots.find(
      (s) => s.floorId === selectedFloorId && s.slotCode === selectedSlotCode,
    );
    setSelectedSlot(dbSlot?.reservedFor || dbSlot?.status === 'maintenance' ? null : matched ?? null);
  }, [availableSlots, dbSlots, selectedFloorId, selectedSlotCode]);

  useEffect(() => {
    if (!selectedSlot || isLoading) return;
    const stillAvailable = availableSlots.some(
      (s) => s.floorId === selectedSlot.floorId && s.slotCode === selectedSlot.slotCode,
    );
    if (!stillAvailable) setSelectedSlot(null);
  }, [availableSlots, isLoading, selectedSlot]);

  useEffect(() => {
    if (!selectedSlot || dbSlots === null) return;
    const dbSlot = dbSlots.find(
      (slot) => String(slot.slotNumber || '').toUpperCase() === selectedSlot.slotCode.toUpperCase(),
    );
    if (dbSlot?.reservedFor || dbSlot?.status === 'maintenance') {
      setSelectedSlot(null);
    }
  }, [dbSlots, selectedSlot]);

  // ── Derived values ────────────────────────────────────────────────────────
  const durationMs = Math.max(endTime.getTime() - startTime.getTime(), 0);
  const durationHours = Math.ceil(durationMs / 3_600_000);
  const paidHours = Math.max(durationHours, 1);
  const estimatedParkingCost = paidHours * hourlyRate;

  const serviceTotal = useMemo(
    () =>
      services
        .filter((s) => selectedServiceIds.includes(getServiceId(s)))
        .reduce((sum, s) => sum + Number(s.price || 0), 0),
    [services, selectedServiceIds],
  );

  const localGrandTotal = estimatedParkingCost + serviceTotal;
  const grandTotal = serverQuoteTotal ?? localGrandTotal;
  const parkingCost = Math.max(grandTotal - serviceTotal, 0);
  const hasEnoughBalance = walletBalance >= grandTotal;
  const selectedVehicle = vehicles.find((v) => selectedVehicleId === 'manual'
    ? normalizeLicensePlate(v.licensePlate) === normalizeLicensePlate(manualPlate)
    : (v.id ?? v._id ?? '') === selectedVehicleId);
  const activeVipMembership = Boolean(
    membership?.isVip &&
    membership.status === 'active' &&
    membership.expireAt &&
    new Date(membership.expireAt).getTime() > startTime.getTime() &&
    (membership.package?.type === 'monthly' || membership.package?.type === 'yearly'),
  );
  const selectedSlotIsOwnVipSlot = Boolean(
    activeVipMembership && selectedSlot && membership?.expireAt && new Date(membership.expireAt) >= endTime && membership?.reservedSlots.some((slot) => (
      String(slot.floorId) === String(selectedSlot.floorId) &&
      slot.slotCode.toUpperCase() === selectedSlot.slotCode.toUpperCase() &&
      (!slot.expireAt || new Date(slot.expireAt) >= endTime)
    )),
  );
  const membershipBlocksRegisteredVehicle = Boolean(
    activeVipMembership && selectedVehicle && selectedSlot && !selectedSlotIsOwnVipSlot,
  );
  const canBook = Boolean(
    selectedSlot &&
    selectedVehicleId &&
    !membershipBlocksRegisteredVehicle &&
    !submitting &&
    durationMs >= 30 * 60 * 1000,
  );
  const selectedRouteSlotUnavailable =
    Boolean(selectedFloorId && selectedSlotCode) && !selectedSlot && !isLoading && availableSlots.length > 0;
  const disabledReason = !selectedVehicleId
    ? 'Select a vehicle to continue'
    : !selectedSlot
      ? 'Choose an available space'
      : membershipBlocksRegisteredVehicle
        ? 'Use your VIP space first'
        : durationMs < 30 * 60 * 1000
          ? 'Adjust booking duration'
          : '';

  useEffect(() => {
    if (!selectedSlot || !selectedVehicleId || startTime <= new Date() || endTime <= startTime) {
      setServerQuoteTotal(null);
      return;
    }

    const licensePlate = selectedVehicleId === 'manual'
      ? manualPlate.trim()
      : selectedVehicle?.licensePlate;
    if (!licensePlate) {
      setServerQuoteTotal(null);
      return;
    }

    let active = true;
    const timeoutId = setTimeout(() => {
      void bookingService.quoteBulkBooking([{
        clientItemId: 'mobile-preview',
        vehicleId: selectedVehicleId === 'manual' ? undefined : selectedVehicleId,
        licensePlate: selectedVehicleId === 'manual' ? licensePlate : undefined,
        floorId: selectedSlot.floorId,
        slotCode: selectedSlot.slotCode,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        serviceIds: selectedServiceIds,
        voucherId: selectedVoucherId || undefined,
      }]).then((response) => {
        if (active) setServerQuoteTotal(Number(response.data?.grandTotal || 0));
      }).catch(() => {
        if (active) setServerQuoteTotal(null);
      });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [endTime, manualPlate, selectedServiceIds, selectedVoucherId, selectedSlot, selectedVehicle, selectedVehicleId, startTime]);

  // ── Toggle service ────────────────────────────────────────────────────────
  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
  };

  // ── Time picker callbacks ─────────────────────────────────────────────────
  const handleStartConfirm = (date: Date) => {
    setStartTime(date);
    if (endTime.getTime() - date.getTime() < 30 * 60 * 1000) {
      setEndTime(addMinutes(date, 60));
    }
  };

  const handleEndConfirm = (date: Date) => {
    const minEnd = addMinutes(startTime, 30);
    setEndTime(date < minEnd ? minEnd : date);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const showFeedback = (variant: BookingModalVariant, title: string, message: string) => {
    setFeedback({ variant, title, message });
  };

  const handleSubmit = () => {
    if (!selectedSlot || !selectedVehicleId) return;
    if (startTime <= new Date() || durationMs < 30 * 60_000) {
      showFeedback('warning', 'Invalid time', 'Choose a future time with a minimum duration of 30 minutes.'); return;
    }
    if (membershipBlocksRegisteredVehicle) {
      showFeedback('warning', 'Check VIP space', 'Please use your membership space first.'); return;
    }
    const plate = selectedVehicleId === 'manual' ? manualPlate.trim().toUpperCase() : selectedVehicle?.licensePlate;
    if (!plate) { showFeedback('warning', 'Select a vehicle', 'Please enter a license plate or select a vehicle.'); return; }
    setSubmitting(true);
    try {
      cart.add({
        clientItemId: Crypto.randomUUID(),
        vehicleId: selectedVehicleId === 'manual' ? undefined : selectedVehicleId,
        licensePlate: selectedVehicleId === 'manual' ? plate : undefined,
        floorId: selectedSlot.floorId, slotCode: selectedSlot.slotCode,
        startTime: startTime.toISOString(), endTime: endTime.toISOString(),
        serviceIds: selectedServiceIds, voucherId: selectedVoucherId || undefined,
        plateLabel: plate, floorLabel: selectedFloor?.name || selectedSlot.floorName || '',
        voucherLabel: vouchers.find((v) => v._id === selectedVoucherId)?.benefitSnapshot.name,
      });
      setSelectedSlot(null); setSelectedVoucherId('');
      setStep(0);
      navigation.navigate('BookingCart');
    } catch (e) { showFeedback('warning', 'Unable to add to cart', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setSubmitting(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScreenHeader
        accentColor={COLORS.gold}
        headerIcon="calendar-outline"
        headerIconBackground="rgba(226,186,75,0.12)"
        headerIconColor={COLORS.gold}
        progressVariant="accent"
        subtitle="Time & vehicle → Parking space → Cart & payment"
        title="New booking"
        onBack={() => step > 0 ? setStep(step - 1) : navigation.goBack()}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={workflow.row}>
            {['1. Time & vehicle', '2. Parking space', '3. Services & rewards'].map((label, index) => (
              <WorkflowChip key={label} selected={step === index} onPress={() => { if (index < step) setStep(index); }}>{label}</WorkflowChip>
            ))}
          </View>

          {/* ── Time Pickers ──────────────────────────────────── */}
          {step === 0 ? <>
          <TimeTimeline
            durationHours={durationHours}
            endTime={endTime}
            startTime={startTime}
            onEndPress={() => setShowEndPicker(true)}
            onStartPress={() => setShowStartPicker(true)}
          />

          {/* ── Vehicle ───────────────────────────────────────── */}
          <VehicleSelector
            manualPlate={manualPlate}
            membershipBlocksRegisteredVehicle={membershipBlocksRegisteredVehicle}
            selectedVehicleId={selectedVehicleId}
            vehicleError={vehicleError}
            vehicles={vehicles}
            onManageVehicles={() =>
              navigation
                .getParent<BottomTabNavigationProp<CustomerTabParamList>>()
                ?.navigate('ProfileTab', { screen: 'VehicleList' })
            }
            onManualPlateChange={setManualPlate}
            onRetry={loadVehicles}
            onSelectVehicle={setSelectedVehicleId}
          />
          </> : null}

          {step === 1 ?
          <ParkingMapSection
            activeHolds={activeHolds}
            activeSessions={activeSessions}
            availableSlots={availableSlots}
            dbSlots={dbSlots}
            endTime={endTime}
            error={error}
            isLoading={isLoading}
            parkingFloors={parkingFloors}
            selectedFloor={selectedFloor}
            selectedFloorName={selectedFloorName}
            selectedRouteSlotUnavailable={selectedRouteSlotUnavailable}
            selectedSlot={selectedSlot}
            selectedSlotCode={selectedSlotCode}
            selectedVehiclePlate={selectedVehicle?.licensePlate}
            startTime={startTime}
            onClearSlot={() => setSelectedSlot(null)}
            onRetryFloors={() => void fetchParkingFloors()}
            onRetrySlots={(start, end) => void getAvailableSlots(start, end)}
            onSelectFloor={(floor) => {
              setSelectedFloor(floor);
              setSelectedSlot(null);
            }}
            onSelectSlot={setSelectedSlot}
          />
          : null}

          {step === 2 ? <>
          <ServiceList
            selectedServiceIds={selectedServiceIds}
            serviceTotal={serviceTotal}
            services={services}
            onToggleService={toggleService}
          />

          <View style={workflow.panel}>
            <Text style={workflow.title}>Vouchers & rewards</Text>
            {voucherError ? <Text style={workflow.error}>{voucherError}</Text> : null}
            <WorkflowChip selected={!selectedVoucherId} onPress={() => setSelectedVoucherId('')}>No voucher</WorkflowChip>
            {vouchers.filter((v) => !v.bookingId && !cart.items.some((item) => item.voucherId === v._id)).map((v) => (
              <WorkflowChip key={v._id} selected={selectedVoucherId === v._id} onPress={() => setSelectedVoucherId(v._id)}>
                {v.benefitSnapshot.name} · minimum spend {formatCurrency(v.benefitSnapshot.minimumAmount)}
              </WorkflowChip>
            ))}
            <Text style={workflow.body}>The final price and rewards are verified before payment.</Text>
            <WorkflowChip onPress={() => navigation.navigate('BookingCart')}>View cart ({cart.items.length})</WorkflowChip>
          </View>

          <PriceBreakdown
            hourlyRate={hourlyRate}
            paidHours={paidHours}
            parkingCost={parkingCost}
            serviceTotal={serviceTotal}
          />
          </> : null}

        </ScrollView>
      </KeyboardAvoidingView>

      <StickyBookingFooter
        canBook={step === 0 ? Boolean(selectedVehicleId && (selectedVehicleId !== 'manual' || manualPlate.trim()) && startTime > new Date() && durationMs >= 30 * 60_000) : step === 1 ? Boolean(selectedSlot && !membershipBlocksRegisteredVehicle) : canBook}
        disabledReason={disabledReason}
        grandTotal={grandTotal}
        hasEnoughBalance={hasEnoughBalance}
        submitting={submitting}
        walletBalance={walletBalance}
        submitLabel={step < 2 ? 'Continue' : 'Add to cart'}
        onSubmit={() => step < 2 ? setStep(step + 1) : handleSubmit()}
      />

      <BookingActionModal
        message={feedback?.message}
        primaryLabel={feedback?.primaryLabel ?? 'Close'}
        title={feedback?.title ?? ''}
        variant={feedback?.variant ?? 'info'}
        visible={Boolean(feedback)}
        onClose={() => setFeedback(null)}
        onPrimary={() => {
          const callback = feedback?.onPrimary;
          setFeedback(null);
          callback?.();
        }}
      />

      {/* ── Time Picker Modals ─────────────────────────────────── */}
      <TimePickerModal
        visible={showStartPicker}
        title="Select arrival time"
        initialDate={startTime}
        minDate={new Date()}
        onConfirm={handleStartConfirm}
        onClose={() => setShowStartPicker(false)}
      />
      <TimePickerModal
        visible={showEndPicker}
        title="Select departure time"
        initialDate={endTime}
        minDate={addMinutes(startTime, 30)}
        onConfirm={handleEndConfirm}
        onClose={() => setShowEndPicker(false)}
      />
    </SafeAreaView>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  scroll: { gap: SPACING.lg, padding: SPACING.lg, paddingBottom: STICKY_FOOTER_SPACE },

  section: { gap: SPACING.sm },
  hiddenLegacySection: { display: 'none' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionKicker: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Header
  headerShell: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: SPACING.md },
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerTitleWrap: { flex: 1, minWidth: 0 },
  headerTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '800' },
  headerSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  progressTrack: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.round,
    height: 3,
    marginTop: SPACING.md,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: COLORS.gold, borderRadius: RADIUS.round, height: 3, width: '72%' },

  // Compact time timeline
  timeline: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 108,
    padding: SPACING.md,
  },
  timeBlock: { flex: 1, minWidth: 0 },
  timeLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  timeLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  timeValue: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  timeDate: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  timelineMiddle: { alignItems: 'center', flex: 0.76, justifyContent: 'center', minWidth: 82 },
  timelineLine: { backgroundColor: 'rgba(226,186,75,0.35)', height: 1, position: 'absolute', width: '100%' },
  durationChip: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderColor: 'rgba(226,186,75,0.26)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },

  // Time picker cards
  timePickerRow: { flexDirection: 'row', gap: SPACING.sm },
  timePickerCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    flex: 1,
    minHeight: 132,
    padding: SPACING.md,
  },
  timeCardTop: { alignItems: 'center', flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  timePickerIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  timePickerIconExit: { backgroundColor: 'rgba(96,180,255,0.12)' },
  timePickerLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  timePickerValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '800', letterSpacing: 0.2 },
  timePickerDate: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  durationNote: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(226,186,75,0.08)',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
  },
  durationText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600' },

  // Vehicle
  pillRow: { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  vehiclePill: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  vehiclePillActive: { backgroundColor: 'rgba(226,186,75,0.1)', borderColor: COLORS.gold },
  vehicleText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  vehicleTextActive: { color: COLORS.gold },
  defaultDot: { backgroundColor: COLORS.gold, borderRadius: 3, height: 6, marginLeft: 2, width: 6 },
  vehicleEmpty: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  vehicleEmptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  vehicleEmptyCopy: { flex: 1, minWidth: 0 },
  vehicleEmptyTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  vehicleEmptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, lineHeight: 17, marginTop: 2 },
  manageVehicleBtn: {
    alignItems: 'center',
    borderColor: 'rgba(226,186,75,0.35)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: SPACING.sm,
  },
  manageVehicleText: { color: COLORS.gold, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  manualInputWrap: { marginTop: SPACING.xs },
  manualInput: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    color: COLORS.textPrimary,
    minHeight: 48,
    paddingHorizontal: SPACING.md,
  },

  // Slot
  selectedSlotCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(226,186,75,0.35)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  selectedSlotIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  selectedSlotInfo: { flex: 1 },
  selectedSlotCode: { color: COLORS.gold, fontSize: FONT_SIZES.lg, fontWeight: '800' },
  selectedSlotMeta: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  clearSlotBtn: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  warningBox: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,159,67,0.1)',
    borderColor: 'rgba(255,159,67,0.24)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  warningText: { color: COLORS.warning, flex: 1, fontSize: FONT_SIZES.sm, lineHeight: 20 },

  // Floor tabs
  floorTabScroll: { maxHeight: 44, marginTop: SPACING.sm },
  mapSection: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(226,186,75,0.2)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.sm,
    overflow: 'hidden',
    padding: SPACING.md,
  },
  mapHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  mapTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '900', marginTop: 3 },
  availableBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(126,232,162,0.09)',
    borderColor: 'rgba(126,232,162,0.22)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    minWidth: 72,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
  },
  availableCount: { color: COLORS.success, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  availableLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  floorTabs: { alignItems: 'center', gap: SPACING.sm, paddingBottom: SPACING.sm },
  floorTab: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  floorTabActive: { backgroundColor: 'rgba(226,186,75,0.12)', borderColor: COLORS.gold },
  floorTabText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  floorTabTextActive: { color: COLORS.gold },
  floorCount: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.round,
    minWidth: 20,
    paddingHorizontal: 5,
  },
  floorCountActive: { backgroundColor: COLORS.gold },
  floorCountText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  floorCountTextActive: { color: COLORS.textInverse },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  legendDot: { borderRadius: 5, height: 10, width: 10 },
  legendText: { color: COLORS.textSecondary, fontSize: 11 },

  // Map
  mapCanvas: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginTop: SPACING.sm,
    minHeight: 300,
    position: 'relative',
    overflow: 'hidden',
  },
  mapState: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    minHeight: 300,
    position: 'absolute',
    right: 0,
    top: 0,
    padding: SPACING.xl,
  },
  mapStateText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },

  // Services
  serviceTotalBadge: { color: COLORS.gold, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  emptyServices: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
  },
  emptyServicesText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, textAlign: 'center' },
  serviceList: {
    backgroundColor: 'rgba(255,255,255,0.032)',
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  serviceItem: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 64,
    padding: SPACING.md,
  },
  serviceItemActive: { backgroundColor: 'rgba(226,186,75,0.08)' },
  serviceCheckbox: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: 7,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  serviceCheckboxActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  serviceInfo: { flex: 1, minWidth: 0 },
  serviceName: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '700', lineHeight: 19 },
  serviceDuration: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  serviceDescription: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  servicePrice: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '800', marginLeft: SPACING.xs, maxWidth: 110 },
  serviceDivider: {
    backgroundColor: COLORS.border,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 56,
    position: 'absolute',
    right: SPACING.md,
  },

  priceDetails: {
    backgroundColor: 'transparent',
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: SPACING.xs,
    paddingTop: SPACING.md,
  },
  priceLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 28 },

  // Price summary
  priceSummary: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(226,186,75,0.25)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.xs,
    padding: SPACING.lg,
  },
  summaryHeader: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '700' },
  summarySubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  priceRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  priceLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  priceValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  priceTotal: {
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
  },
  totalLabel: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  totalValue: { color: COLORS.gold, fontSize: FONT_SIZES.xl, fontWeight: '800' },
  walletRow: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: SPACING.xs,
    paddingTop: SPACING.sm,
  },
  walletText: { fontSize: FONT_SIZES.xs },

  // Sticky footer
  stickyFooter: {
    borderColor: 'rgba(226,186,75,0.24)',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    bottom: 0,
    elevation: 18,
    left: 0,
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    position: 'absolute',
    right: 0,
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  footerWarning: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,159,67,0.09)',
    borderColor: 'rgba(255,159,67,0.2)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
  },
  footerWarningText: { color: COLORS.warning, flex: 1, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  footerHintText: { color: COLORS.textMuted, flex: 1, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  footerMain: { alignItems: 'center', flexDirection: 'row', gap: SPACING.md },
  footerTotal: { flex: 1, minWidth: 0 },
  footerTotalLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800', textTransform: 'uppercase' },
  footerTotalValue: { color: COLORS.gold, fontSize: FONT_SIZES.xl, fontWeight: '900', marginTop: 2 },
  footerSubmitWrap: { borderRadius: RADIUS.lg, minWidth: 168, overflow: 'hidden' },
  footerSubmitGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    height: 54,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  footerSubmitText: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '900' },
  footerSubmitTextDisabled: { color: COLORS.textMuted },

  // Submit
  submitBtn: { borderRadius: RADIUS.lg, display: 'none', overflow: 'hidden' },
  submitDisabled: { opacity: 0.5 },
  submitGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    height: 56,
    justifyContent: 'center',
  },
  submitText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '700' },
});
