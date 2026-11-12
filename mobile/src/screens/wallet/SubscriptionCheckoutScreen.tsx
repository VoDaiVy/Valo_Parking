import { useFocusEffect } from '@react-navigation/native';
import { PackageText as Text } from '@/components/profile/PackageText';
import { EntitlementVehiclePicker } from '@/components/profile/EntitlementVehiclePicker';
import * as Crypto from 'expo-crypto';
import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader, SectionTitle } from '@/components/common';
import { ParkingMap2D } from '@/components/booking/ParkingMap2D';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { WalletStackParamList } from '@/navigation/types';
import parkingFloorService from '@/services/ParkingFloorService';
import { subscriptionsService } from '@/services/api/subscriptions';
import { profileService } from '@/services/api/profile';
import { walletService } from '@/services/api/wallet';
import type { ParkingFloor, Slot } from '@/types/booking.types';
import type { Wallet } from '@/types/models';
import type { MembershipStatus, SubscriptionPackage, SubscriptionPaymentMethod, SubscriptionSlotSelection } from '@/types/subscription.types';
import { formatCurrency } from '@/utils/formatters';
import { isPolicyAcceptanceRequired } from '@/utils/policyErrors';
import {
  calculateExpirationDate,
  calculateSubscriptionTotal,
  getSubscriptionPackageRestriction,
} from '@/utils/walletSubscription';

type Props = NativeStackScreenProps<WalletStackParamList, 'SubscriptionCheckout'>;

export const SubscriptionCheckoutScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [floors, setFloors] = useState<ParkingFloor[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [purchaseKeys] = useState(() => new Map<string, string>());
  const [selectedSlots, setSelectedSlots] = useState<SubscriptionSlotSelection[]>([]);
  const [method, setMethod] = useState<SubscriptionPaymentMethod>('wallet');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [policyRequired, setPolicyRequired] = useState(false);

  const pkg = useMemo(
    () => packages.find((item) => item._id === route.params.packageId),
    [packages, route.params.packageId],
  );

  const maxSlots = Math.max(
    0,
    membership?.purchaseEligibility?.customerId === customerId ? Math.min(pkg?.maxSlots ?? 3, membership.purchaseEligibility.availableVehicleCapacity) : 0,
  );
  const subscriptionTotal = calculateSubscriptionTotal(pkg?.price || 0, selectedSlots.length);
  const hasEnoughWallet = (wallet?.balance || 0) >= subscriptionTotal;
  const packageRestriction = getSubscriptionPackageRestriction(membership, pkg) || (maxSlots === 0 ? membership?.purchaseEligibility?.reason || 'Unable to verify purchase eligibility.' : null);
  const selectedFloor = floors.find((floor) => String(floor._id ?? floor.id) === selectedFloorId) || null;

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [packageResponse, profileResponse, walletResponse, floorResponse, membershipResponse] = await Promise.all([
        subscriptionsService.getPackages(),
        profileService.getProfile(),
        walletService.getWallet(),
        parkingFloorService.getParkingFloors(),
        subscriptionsService.getMembership(),
      ]);
      setPackages(packageResponse.data || []);
      if (!profileResponse.data?.id || membershipResponse.data?.purchaseEligibility?.customerId !== String(profileResponse.data.id)) throw new Error('Unable to verify purchase eligibility.');
      setCustomerId(String(profileResponse.data.id));
      setWallet(walletResponse.data || null);
      setMembership(membershipResponse.data || null);
      setFloors(floorResponse);
      setSelectedFloorId((current) => current || String(floorResponse[0]?._id ?? floorResponse[0]?.id ?? ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load plan details.');
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));

  useEffect(() => {
    let active = true;
    if (!selectedFloorId) {
      setSlots([]);
      return () => { active = false; };
    }
    setSlots([]);
    void parkingFloorService.getSlotsByFloor(selectedFloorId)
      .then((floorSlots) => {
        if (active) setSlots(floorSlots);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load parking spaces.');
      });
    return () => { active = false; };
  }, [selectedFloorId]);

  const toggleSlot = ({ floorId, slotCode }: SubscriptionSlotSelection) => {
    setSelectedSlots((current) => {
      const exists = current.some((item) => item.floorId === floorId && item.slotCode === slotCode);
      if (exists) {
        return current.filter((item) => !(item.floorId === floorId && item.slotCode === slotCode));
      }
      if (current.length >= maxSlots) {
        setError(`You can select up to ${maxSlots} spaces based on your registered vehicles.`);
        return current;
      }
      setError('');
      return [...current, { floorId, slotCode }];
    });
  };

  const handlePurchase = async () => {
    if (!pkg) {
      setError('The selected plan was not found.');
      return;
    }
    if (packageRestriction) {
      setError(packageRestriction);
      return;
    }
    if (selectedSlots.length < 1 || selectedSlots.length > maxSlots) {
      setError(`Select 1-${maxSlots} spaces based on your registered vehicles.`);
      return;
    }
    if (selectedSlots.some((slot) => !slot.vehicleId) || new Set(selectedSlots.map((slot) => slot.vehicleId)).size !== selectedSlots.length) {
      setError('Choose a different approved vehicle for each reserved space.');
      return;
    }
    if (method === 'wallet' && !hasEnoughWallet) {
      setError('Insufficient wallet balance.');
      return;
    }

    const context = JSON.stringify([pkg._id, method, selectedSlots]);
    if (!purchaseKeys.has(context)) purchaseKeys.set(context, Crypto.randomUUID());
    const idempotencyKey = purchaseKeys.get(context)!;
    setSubmitting(true);
    setError('');
    setPolicyRequired(false);
    try {
      if (method === 'wallet') {
        await subscriptionsService.payWithWallet({ packageId: pkg._id, slots: selectedSlots, idempotencyKey });
        navigation.navigate('Membership');
      } else {
        const response = await subscriptionsService.createPayment({ packageId: pkg._id, slots: selectedSlots, idempotencyKey });
        navigation.navigate('SubscriptionPaymentStatus', {
          orderCode: response.data.orderCode,
          checkoutUrl: response.data.checkoutUrl,
          qrCode: response.data.qrCode,
          amount: response.data.amount,
        });
      }
    } catch (purchaseError) {
      if ((purchaseError as { code?: string }).code === 'PURCHASE_ATTEMPT_CLOSED') purchaseKeys.delete(context);
      if (isPolicyAcceptanceRequired(purchaseError)) {
        setPolicyRequired(true);
        setError('You must accept the latest policy before purchasing a plan.');
      } else {
        setError(purchaseError instanceof Error ? purchaseError.message : 'Plan purchase failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={translateUi("Plan checkout")} onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error && !pkg ? (
        <ErrorState message={translateUi(error)} onRetry={loadData} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {pkg ? (
            <View style={styles.packageCard}>
              <Text style={styles.packageName}>{pkg.name}</Text>
              <Text style={styles.packageMeta}>{pkg.type === 'monthly' ? '30 days (720 hours)' : '12 calendar months'} / {pkg.service === 'RESERVED_PAID' ? 'Standard parking fees' : 'Base parking included while effective'}</Text>
              <Text style={styles.packagePrice}>{formatCurrency(pkg.price)}</Text>
              <Text style={styles.packageMeta}>{translateUi("Total for selected spaces:")}{" "}{formatCurrency(subscriptionTotal)}</Text>
              <Text style={styles.packageMeta}>
                {" "}{translateUi("Expires:")}{" "}{calculateExpirationDate(pkg.type).toLocaleDateString('en-GB')}
              </Text>
            </View>
          ) : (
            <EmptyState icon="cube-outline" title={translateUi("Plan not found")} message={translateUi("Please go back and choose another plan.")} />
          )}

          <View style={styles.section}>
            <SectionTitle>{translateUi("Payment method")}</SectionTitle>
            {(['wallet', 'payos'] as const).map((option) => {
              const active = method === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.methodCard, active && styles.methodCardActive]}
                  onPress={() => setMethod(option)}
                >
                  <View style={styles.methodLeft}>
                    <Ionicons
                      name={option === 'wallet' ? 'wallet-outline' : 'qr-code-outline'}
                      size={20}
                      color={active ? COLORS.gold : COLORS.textMuted}
                    />
                    <Text style={[styles.methodText, active && styles.methodTextActive]}>
                      {option === 'wallet' ? translateUi("VALO Wallet") : 'PayOS QR'}
                    </Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={20} color={COLORS.gold} /> : null}
                </Pressable>
              );
            })}
            <Text style={[styles.walletBalance, { color: hasEnoughWallet ? COLORS.success : COLORS.error }]}>
              {" "}{translateUi("Wallet balance:")}{" "}{formatCurrency(wallet?.balance || 0)}
            </Text>
          </View>

          <View style={styles.section}>
            <SectionTitle>{translateUi("Select reserved spaces")}</SectionTitle>
            <Text style={styles.helperText}>
              {maxSlots > 0
                ? `Select 1-${maxSlots} spaces based on your registered vehicles. Gold spaces are already reserved; blue spaces are your selection.`
                : 'Add at least one vehicle before purchasing a plan.'}
            </Text>
            <View style={styles.floorTabs}>
              {floors.map((floor) => {
                const floorId = String(floor._id ?? floor.id);
                const active = floorId === selectedFloorId;
                return (
                  <Pressable key={floorId} style={[styles.floorTab, active && styles.floorTabActive]} onPress={() => setSelectedFloorId(floorId)}>
                    <Text style={[styles.floorTabText, active && styles.floorTabTextActive]}>{floor.name || `Floor ${floor.floorNumber}`}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!selectedFloor ? (
              <EmptyState icon="car-outline" title={translateUi("No spaces available")} message={translateUi("Please try again later.")} />
            ) : (
              <View style={styles.mapCard}>
                <ParkingMap2D
                  floor={selectedFloor}
                  floorSlots={[]}
                  selectedSlot={null}
                  onSelectSlot={() => undefined}
                  dbSlots={slots}
                  selectionMode="membership"
                  selectedSlots={selectedSlots}
                  onToggleSlot={toggleSlot}
                />
              </View>
            )}
            <Text style={styles.selectedCount}>{translateUi("Selected:")}{" "}{selectedSlots.length}/{maxSlots}</Text>
          </View>

          {error || packageRestriction ? (
            <View style={styles.warningBox}>
              <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
              <Text style={styles.warningText}>{error || packageRestriction}</Text>
            </View>
          ) : null}

          {selectedSlots.map((slot) => <EntitlementVehiclePicker key={`${slot.floorId}:${slot.slotCode}`} label={`Vehicle for space ${slot.slotCode}`} value={slot.vehicleId} eligible={membership?.purchaseEligibility?.eligibleVehicleIds || []} excluded={[...selectedSlots.filter((other) => other !== slot).map((other) => other.vehicleId || ''), ...(membership?.reservedSlots || []).map((item) => item.vehicleId || '')]} onChange={(vehicleId) => setSelectedSlots((current) => current.map((item) => item === slot ? { ...item, vehicleId } : item))} />)}
          {policyRequired ? (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.policyButton}
              onPress={() => navigation.getParent<NavigationProp<CustomerTabParamList>>()?.navigate('ProfileTab', { screen: 'Policies' })}
            >
              <Text style={styles.policyButtonText}>{translateUi("Review and accept policy")}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity activeOpacity={0.85} disabled={submitting || !pkg || Boolean(packageRestriction)} style={[styles.primaryButton, (submitting || !pkg || Boolean(packageRestriction)) && styles.disabled]} onPress={handlePurchase}>
            {submitting ? (
              <ActivityIndicator color={COLORS.textInverse} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.textInverse} />
                <Text style={styles.primaryButtonText}>{translateUi("Confirm purchase")}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    gap: SPACING.lg,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  packageCard: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(212,175,55,0.28)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.lg,
  },
  packageName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '900',
  },
  packagePrice: {
    color: COLORS.gold,
    fontSize: 30,
    fontWeight: '900',
    marginTop: SPACING.sm,
  },
  packageMeta: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginTop: SPACING.xs,
  },
  section: {
    gap: SPACING.sm,
  },
  methodCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: SPACING.md,
  },
  methodCardActive: {
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderColor: COLORS.gold,
  },
  methodLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  methodText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  methodTextActive: {
    color: COLORS.gold,
  },
  walletBalance: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    marginTop: SPACING.xs,
  },
  helperText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
  },
  floorTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  floorTab: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  floorTabActive: {
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderColor: COLORS.gold,
  },
  floorTabText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  floorTabTextActive: {
    color: COLORS.gold,
  },
  mapCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  selectedCount: {
    color: COLORS.staffBlue,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  warningBox: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderColor: 'rgba(255,77,77,0.24)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  warningText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  policyButton: {
    alignItems: 'center',
    borderColor: COLORS.gold,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  policyButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 54,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 24,
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
});
