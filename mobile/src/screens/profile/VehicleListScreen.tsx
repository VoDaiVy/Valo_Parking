import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, ProfileScreenHeader, StatusChip } from '@/components/profile/ProfileUI';
import { ErrorState } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import type { ProfileStackParamList } from '@/navigation/types';
import { MAX_VEHICLES_PER_USER, vehiclesService } from '@/services/api/vehicles';
import type { Vehicle } from '@/types/models';

type Props = NativeStackScreenProps<ProfileStackParamList, 'VehicleList'>;

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<string, string> = {
  approved: COLORS.success,
  pending: COLORS.warning,
  rejected: COLORS.error,
};

const getVehicleId = (vehicle: Vehicle) => vehicle.id || vehicle._id || '';

function AddFab({ onPress }: { onPress: () => void }) {
  const { t: translateUi } = useLanguage();
  return (
    <AnimatedPressable accessibilityLabel={translateUi("Add vehicle")} onPress={onPress} style={styles.addButtonOuter} tint="rgba(226,186,75,0.08)">
      <View style={styles.addButton}>
        <Ionicons name="add" size={22} color={COLORS.textInverse} />
      </View>
    </AnimatedPressable>
  );
}

function EmptyVehicles({ onAdd }: { onAdd: () => void }) {
  const { t: translateUi } = useLanguage();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      duration: 520,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.empty,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.emptyIcon}>
        <Ionicons name="car-outline" size={34} color={COLORS.gold} />
      </View>
      <Text style={styles.emptyTitle}>{translateUi("No vehicles yet")}</Text>
      <Text style={styles.emptyText}>{translateUi("Add a vehicle for faster booking and automatic check-in.")}</Text>
      <AnimatedPressable accessibilityLabel={translateUi("Add vehicle")} onPress={onAdd} style={styles.emptyCta} tint="rgba(226,186,75,0.08)">
        <View style={styles.emptyCtaInner}>
          <Text style={styles.emptyCtaText}>{translateUi("Add vehicle")}</Text>
          <Ionicons name="arrow-forward" size={16} color={COLORS.gold} />
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

function VehicleRow({
  index,
  item,
  onPress,
}: {
  index: number;
  item: Vehicle;
  onPress: () => void;
}) {
  const { t: translateUi } = useLanguage();
  const entrance = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const status = item.status || 'pending';
  const statusColor = STATUS_COLORS[status] ?? COLORS.textMuted;
  const description = [item.brand, item.model].filter(Boolean).join(' ') || item.vehicleType || 'Vehicle';

  useEffect(() => {
    Animated.timing(entrance, {
      delay: 90 + index * 55,
      duration: 430,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  const animateArrow = (toValue: number) => {
    Animated.spring(arrow, {
      damping: 16,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.vehicleWrap,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
          ],
        },
      ]}
    >
      <AnimatedPressable
        accessibilityLabel={`${translateUi("Vehicle")} ${item.licensePlate}`}
        onPress={onPress}
        onPressIn={() => animateArrow(1)}
        onPressOut={() => animateArrow(0)}
      >
        <View style={styles.vehicleRow}>
          <View style={styles.vehicleIconWrap}>
            <Ionicons name={item.vehicleType === 'electric_car' ? 'flash-outline' : 'car-sport-outline'} size={24} color={COLORS.gold} />
          </View>
          <View style={styles.vehicleBody}>
            <View style={styles.vehicleTop}>
              <Text style={styles.plate} numberOfLines={1}>{item.licensePlate}</Text>
              {item.isDefault ? <Text style={styles.defaultBadge}>{translateUi("Default")}</Text> : null}
            </View>
            <Text style={styles.vehicleMeta} numberOfLines={2}>
              {description}
            </Text>
            <View style={styles.vehicleFooter}>
              <StatusChip color={statusColor} label={STATUS_LABELS[status] ?? status} />
              <View style={styles.colorDetail}><View style={[styles.colorSwatch, { backgroundColor: /^#[0-9a-f]{6}$/i.test(item.hexColor || '') ? item.hexColor : '#969DA7' }]} /><Text style={styles.colorText}>{item.color || translateUi('Not specified')}</Text></View>
            </View>
          </View>
          <Animated.View
            style={{
              transform: [
                {
                  translateX: arrow.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 4],
                  }),
                },
              ],
            }}
          >
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </Animated.View>
        </View>
      </AnimatedPressable>

    </Animated.View>
  );
}

export const VehicleListScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadVehicles = useCallback(async () => {
    setError('');
    try {
      const response = await vehiclesService.getMyVehicles();
      setVehicles(response.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load vehicles.');
      setVehicles([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadVehicles();
    }, [loadVehicles]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    void loadVehicles();
  };

  const vehicleLimitReached = vehicles.length >= MAX_VEHICLES_PER_USER;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ProfileScreenHeader
        title={translateUi("My vehicles")}
        subtitle={translateUi("Manage your registered vehicles")}
        onBack={() => navigation.goBack()}
        right={!vehicleLimitReached && !loading && !error ? <AddFab onPress={() => navigation.navigate('AddVehicle')} /> : undefined}
      />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={loadVehicles} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={vehicles}
          keyExtractor={(item, index) => getVehicleId(item) || String(index)}
          ListHeaderComponent={vehicles.length > 0 ? (
            <View style={styles.overview}>
              <View style={styles.overviewTop}>
                <View style={styles.overviewIcon}><Ionicons name="car-sport-outline" size={24} color={COLORS.gold} /></View>
                <View style={styles.overviewCopy}>
                  <Text style={styles.overviewTitle}>{translateUi('Your garage')}</Text>
                  <Text style={styles.overviewText}>{translateUi('Vehicles saved for your next trip')}</Text>
                </View>
                <Text style={styles.overviewCount}>{vehicles.length}<Text style={styles.countTotal}>/{MAX_VEHICLES_PER_USER}</Text></Text>
              </View>
              <View style={styles.capacityTrack}><View style={[styles.capacityFill, { width: `${Math.min(100, vehicles.length / MAX_VEHICLES_PER_USER * 100)}%` }]} /></View>
              <Text style={styles.overviewHint}>{translateUi(vehicleLimitReached ? 'Garage full. Remove a vehicle before adding another.' : 'Add up to 3 vehicles to your account.')}</Text>
              <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{translateUi('Registered vehicles')}</Text><Text style={styles.sectionHint}>{translateUi('Tap to manage')}</Text></View>
            </View>
          ) : undefined}
          ListFooterComponent={vehicles.length > 0 ? <View style={styles.helpRow}><Ionicons name="information-circle-outline" size={19} color={COLORS.textMuted} /><Text style={styles.helpText}>{translateUi('Your default vehicle is selected automatically when booking.')}</Text></View> : undefined}
          ListEmptyComponent={<EmptyVehicles onAdd={() => navigation.navigate('AddVehicle')} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
          }
          renderItem={({ item, index }) => (
            <VehicleRow
              index={index}
              item={item}
              onPress={() => navigation.navigate('EditVehicle', { vehicleId: getVehicleId(item) })}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  overview: { marginBottom: 16 },
  overviewTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  overviewIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: COLORS.goldTint, alignItems: 'center', justifyContent: 'center' },
  overviewCopy: { flex: 1 },
  overviewTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  overviewText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  overviewCount: { color: COLORS.gold, fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countTotal: { color: COLORS.textMuted, fontSize: 16, fontWeight: '500' },
  capacityTrack: { height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginTop: 20, overflow: 'hidden' },
  capacityFill: { height: 4, borderRadius: 2, backgroundColor: COLORS.gold },
  overviewHint: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 10 },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 28 },
  sectionTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  sectionHint: { color: COLORS.textMuted, fontSize: 12 },
  colorDetail: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorText: { color: COLORS.textSecondary, fontSize: 12 },
  helpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4, paddingVertical: 12 },
  helpText: { flex: 1, color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  addButtonOuter: {
    borderRadius: RADIUS.round,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.round,
    height: 48,
    justifyContent: 'center',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    width: 48,
  },
  limitBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.08)',
    borderColor: 'rgba(226,186,75,0.24)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  limitBadgeText: {
    color: COLORS.gold,
    fontSize: 12,
    fontWeight: '800',
  },
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingBottom: 118,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  vehicleWrap: {
    marginBottom: 14,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  vehicleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 142,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  vehicleIconWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.08)',
    borderRadius: RADIUS.md,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  vehicleBody: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  vehicleTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  plate: {
    ...typography.h3,
    color: COLORS.textPrimary,
    flex: 1,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.7,
  },
  defaultBadge: {
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.round,
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  vehicleMeta: {
    ...typography.body2,
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  vehicleFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  colorSwatch: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    height: 12,
    width: 12,
  },
  rowDivider: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    minHeight: 390,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxl,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 40,
    borderWidth: 1,
    height: 80,
    justifyContent: 'center',
    marginBottom: SPACING.lg,
    width: 80,
  },
  emptyTitle: {
    ...typography.h3,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  emptyCta: {
    borderRadius: RADIUS.round,
    marginTop: SPACING.lg,
  },
  emptyCtaInner: {
    alignItems: 'center',
    borderColor: COLORS.gold,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 46,
    paddingHorizontal: SPACING.lg,
  },
  emptyCtaText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
  },
});
