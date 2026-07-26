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
  return (
    <AnimatedPressable accessibilityLabel="Add vehicle" onPress={onPress} style={styles.addButtonOuter} tint="rgba(226,186,75,0.08)">
      <View style={styles.addButton}>
        <Ionicons name="add" size={22} color={COLORS.textInverse} />
      </View>
    </AnimatedPressable>
  );
}

function EmptyVehicles({ onAdd }: { onAdd: () => void }) {
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
      <Text style={styles.emptyTitle}>No vehicles yet</Text>
      <Text style={styles.emptyText}>Add a vehicle for faster booking and automatic check-in.</Text>
      <AnimatedPressable accessibilityLabel="Add vehicle" onPress={onAdd} style={styles.emptyCta} tint="rgba(226,186,75,0.08)">
        <View style={styles.emptyCtaInner}>
          <Text style={styles.emptyCtaText}>Add vehicle</Text>
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
        accessibilityLabel={`Vehicle ${item.licensePlate}`}
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
              {item.isDefault ? <Text style={styles.defaultBadge}>Default</Text> : null}
            </View>
            <Text style={styles.vehicleMeta} numberOfLines={2}>
              {description}{item.color ? ` · ${item.color}` : ''}
            </Text>
            <View style={styles.vehicleFooter}>
              <StatusChip color={statusColor} label={STATUS_LABELS[status] ?? status} />
              <View style={[styles.colorSwatch, { backgroundColor: item.hexColor || '#ffffff' }]} />
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
      <View style={styles.rowDivider} />
    </Animated.View>
  );
}

export const VehicleListScreen = ({ navigation }: Props) => {
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
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ProfileScreenHeader
        title="My vehicles"
        subtitle={`${vehicles.length}/${MAX_VEHICLES_PER_USER} vehicles`}
        onBack={() => navigation.goBack()}
        right={
          vehicleLimitReached ? (
            <View style={styles.limitBadge}>
              <Ionicons name="checkmark" size={15} color={COLORS.gold} />
              <Text style={styles.limitBadgeText}>Limit reached</Text>
            </View>
          ) : (
            <AddFab onPress={() => navigation.navigate('AddVehicle')} />
          )
        }
      />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={loadVehicles} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={vehicles}
          keyExtractor={(item, index) => getVehicleId(item) || String(index)}
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
    shadowOpacity: 0.18,
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
    paddingBottom: 118,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  vehicleWrap: {
    marginBottom: SPACING.lg,
  },
  vehicleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 86,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  vehicleIconWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.08)',
    borderRadius: RADIUS.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
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
  },
  plate: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  defaultBadge: {
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: RADIUS.round,
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  vehicleMeta: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  vehicleFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  colorSwatch: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    height: 20,
    width: 20,
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
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  emptyText: {
    color: COLORS.textMuted,
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
