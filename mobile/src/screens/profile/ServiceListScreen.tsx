import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { ProfileStackParamList } from '@/navigation/types';
import serviceService from '@/services/ServiceService';
import type { Service } from '@/types/booking.types';
import { formatCurrency } from '@/utils/formatters';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Services'>;
type ServiceWithTimeCost = Service & { timeCost?: number };

const AnimatedImage = Animated.createAnimatedComponent(Image);

const getServiceId = (service: Service) => service._id || service.id || '';

const getServiceDuration = (service: ServiceWithTimeCost) =>
  service.estimatedTimeMinutes ?? service.estimatedTime ?? service.timeCost ?? 0;

function EditorialHeader({ onBack }: { onBack: () => void }) {
  const { t: translateUi } = useLanguage();
  const entrance = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const pressScale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.94],
  });

  return (
    <Animated.View
      style={[
        styles.header,
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
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <Pressable
          accessibilityLabel={translateUi("Go back")}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backButton}
          onPress={onBack}
          onPressIn={() => {
            Animated.spring(press, {
              damping: 16,
              stiffness: 260,
              toValue: 1,
              useNativeDriver: true,
            }).start();
          }}
          onPressOut={() => {
            Animated.spring(press, {
              damping: 16,
              stiffness: 260,
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </Pressable>
      </Animated.View>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>{translateUi("Services")}</Text>
        <Text style={styles.subtitle}>{translateUi("Premium care for your vehicle")}</Text>
      </View>
    </Animated.View>
  );
}

function ServiceSummary({ count }: { count: number }) {
  const { t: translateUi } = useLanguage();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      delay: 120,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.summary,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.sectionLabelRow}>
        <View style={styles.goldLine} />
        <Text style={styles.sectionLabel}>{translateUi("Available now")}</Text>
      </View>
      <View style={styles.summaryLine}>
        <Ionicons name="sparkles-outline" size={15} color={COLORS.goldLight} />
        <Text style={styles.summaryPrimary}>{count} {" "}{translateUi("services available")}</Text>
        <Text style={styles.summaryDivider}>·</Text>
        <Text style={styles.summarySecondary}>{translateUi("By appointment")}</Text>
      </View>
      <View style={styles.summaryLine}>
        <Ionicons name="shield-checkmark-outline" size={15} color={COLORS.textMuted} />
        <Text style={styles.summarySecondary}>{translateUi("Quality assured")}</Text>
      </View>
    </Animated.View>
  );
}

function ServiceRow({ item, index, onPress }: { item: Service; index: number; onPress: () => void }) {
  const { t: translateUi } = useLanguage();
  const image = item.imageUrl || item.image;
  const duration = getServiceDuration(item);
  const entrance = useRef(new Animated.Value(0)).current;
  const rowScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;
  const imagePressScale = useRef(new Animated.Value(1)).current;
  const chevronTranslate = useRef(new Animated.Value(0)).current;
  const pressTintValue = useRef(new Animated.Value(0)).current;
  const dotPulse = useRef(new Animated.Value(0)).current;
  const imageFade = useRef(new Animated.Value(image ? 0 : 1)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(entrance, {
        delay: 110 + index * 70,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(360 + index * 70),
        Animated.timing(dotPulse, {
          duration: 520,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start();
    return () => animation.stop();
  }, [dotPulse, entrance, index]);

  const animatePress = (pressed: boolean) => {
    Animated.parallel([
      Animated.spring(rowScale, {
        bounciness: 4,
        speed: 24,
        toValue: pressed ? 0.985 : 1,
        useNativeDriver: true,
      }),
      Animated.spring(imagePressScale, {
        bounciness: 4,
        speed: 24,
        toValue: pressed ? 1.025 : 1,
        useNativeDriver: true,
      }),
      Animated.timing(pressOpacity, {
        duration: 140,
        easing: Easing.out(Easing.cubic),
        toValue: pressed ? 0.92 : 1,
        useNativeDriver: true,
      }),
      Animated.timing(chevronTranslate, {
        duration: 140,
        easing: Easing.out(Easing.cubic),
        toValue: pressed ? 4 : 0,
        useNativeDriver: true,
      }),
      Animated.timing(pressTintValue, {
        duration: 140,
        easing: Easing.out(Easing.cubic),
        toValue: pressed ? 1 : 0,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const imageScale = Animated.add(
    entrance.interpolate({
      inputRange: [0, 1],
      outputRange: [0.96, 1],
    }),
    Animated.subtract(imagePressScale, 1),
  );
  const backgroundColor = pressTintValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0)', 'rgba(226,186,75,0.035)'],
  });
  const dotScale = dotPulse.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [1, 1.85, 1],
  });
  const dotOpacity = dotPulse.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0.7, 1, 0.9],
  });
  const priceTranslate = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  return (
    <Animated.View
      style={[
        styles.serviceWrap,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [22, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Animated.View style={{ opacity: pressOpacity, transform: [{ scale: rowScale }] }}>
        <Animated.View style={[styles.serviceTint, { backgroundColor }]}>
          <Pressable
            accessibilityLabel={`${item.name}, ${formatCurrency(item.price)}, available`}
            accessibilityRole="button"
            style={styles.serviceRow}
            onPress={onPress}
            onPressIn={() => animatePress(true)}
            onPressOut={() => animatePress(false)}
          >
            <View style={styles.imageShadow}>
              <View style={styles.imageClip}>
                {image ? (
                  <AnimatedImage
                    source={{ uri: image }}
                    style={[
                      styles.serviceImage,
                      {
                        opacity: imageFade,
                        transform: [{ scale: imageScale }],
                      },
                    ]}
                    onLoad={() => {
                      Animated.timing(imageFade, {
                        duration: 260,
                        easing: Easing.out(Easing.cubic),
                        toValue: 1,
                        useNativeDriver: true,
                      }).start();
                    }}
                  />
                ) : (
                  <View style={styles.serviceIcon}>
                    <Ionicons name="sparkles-outline" size={28} color={COLORS.gold} />
                  </View>
                )}
                <LinearGradient
                  colors={['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.34)']}
                  pointerEvents="none"
                  style={styles.imageOverlay}
                />
              </View>
            </View>

            <View style={styles.serviceBody}>
              <View style={styles.serviceTop}>
                <Text style={styles.serviceName} numberOfLines={2}>
                  {item.name}
                </Text>
              </View>

              {item.description ? (
                <Animated.Text
                  style={[
                    styles.serviceDescription,
                    {
                      opacity: entrance,
                    },
                  ]}
                  numberOfLines={3}
                >
                  {item.description}
                </Animated.Text>
              ) : null}

              <Animated.View style={[styles.metaRow, { opacity: entrance }]}>
                <View style={styles.metaCluster}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-clear-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{duration > 0 ? `${duration} min` : translateUi("By appointment")}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Animated.View
                      style={[
                        styles.statusDot,
                        {
                          opacity: dotOpacity,
                          transform: [{ scale: dotScale }],
                        },
                      ]}
                    />
                    <Text style={styles.metaText}>{translateUi("Available")}</Text>
                  </View>
                </View>
                <View style={styles.priceAction}>
                  <Animated.Text
                    numberOfLines={1}
                    style={[
                      styles.servicePrice,
                      {
                        opacity: entrance,
                        transform: [{ translateX: priceTranslate }],
                      },
                    ]}
                  >
                    {formatCurrency(item.price)}
                  </Animated.Text>
                  <Animated.View style={{ transform: [{ translateX: chevronTranslate }] }}>
                    <Ionicons name="chevron-forward" size={20} color={COLORS.goldLight} />
                  </Animated.View>
                </View>
              </Animated.View>
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.itemDivider, { opacity: entrance }]} />
    </Animated.View>
  );
}

export const ServiceListScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadServices = useCallback(async () => {
    setError('');
    try {
      const response = await serviceService.getActiveServices();
      setServices(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load services.');
      setServices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadServices();
  };

  const openBookingWithService = (service: Service) => {
    const serviceId = getServiceId(service);
    if (!serviceId) return;

    const tabNavigation = navigation.getParent<BottomTabNavigationProp<CustomerTabParamList>>();
    tabNavigation?.navigate('Bookings', {
      screen: 'CreateBooking',
      params: { selectedServiceId: serviceId },
    });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <EditorialHeader onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={loadServices} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={services}
          keyExtractor={(item, index) => item._id || item.id || String(index)}
          ListHeaderComponent={<ServiceSummary count={services.length} />}
          ListEmptyComponent={
            <EmptyState
              icon="sparkles-outline"
              title={translateUi("No services available")}
              message={translateUi("New services will appear here as they become available.")}
            />
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
          }
          renderItem={({ item, index }) => (
            <ServiceRow item={item} index={index} onPress={() => openBookingWithService(item)} />
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
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.md,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerCopy: {
    flex: 1,
    paddingTop: 1,
  },
  title: {
    ...typography.h2,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...typography.body2,
    color: COLORS.textMuted,
    marginTop: 3,
  },
  list: {
    paddingBottom: 124,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
  },
  summary: {
    gap: 10,
    marginBottom: SPACING.xl,
  },
  sectionLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: 2,
  },
  goldLine: {
    backgroundColor: COLORS.gold,
    height: 1,
    width: 34,
  },
  sectionLabel: {
    color: COLORS.goldLight,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  summaryLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    flexWrap: 'wrap',
  },
  summaryPrimary: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  summarySecondary: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  summaryDivider: {
    color: COLORS.gold,
    fontSize: 18,
    marginHorizontal: 2,
  },
  serviceWrap: {
    marginBottom: SPACING.xl,
  },
  serviceRow: {
    borderRadius: RADIUS.lg,
    gap: SPACING.md,
    minHeight: 0,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  serviceTint: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  imageShadow: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  imageClip: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    height: 152,
    overflow: 'hidden',
    width: '100%',
  },
  serviceImage: {
    height: 152,
    width: '100%',
  },
  imageOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  serviceIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.08)',
    height: 152,
    justifyContent: 'center',
    width: '100%',
  },
  serviceBody: {
    minWidth: 0,
  },
  serviceTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  serviceName: {
    ...typography.h3,
    color: COLORS.textPrimary,
    letterSpacing: 0,
    minWidth: 0,
  },
  servicePrice: {
    ...typography.h3,
    fontVariant: ['tabular-nums'],
    color: COLORS.gold,
    flexShrink: 0,
    letterSpacing: 0,
    maxWidth: 142,
    textAlign: 'right',
  },
  serviceDescription: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    marginTop: SPACING.sm,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'space-between',
    marginTop: SPACING.md,
  },
  metaCluster: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  metaText: {
    ...typography.body2,
    color: COLORS.textSecondary,
  },
  statusDot: {
    backgroundColor: COLORS.success,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  itemDivider: {
    backgroundColor: 'rgba(226,186,75,0.14)',
    height: StyleSheet.hairlineWidth,
    marginTop: 3,
  },
  priceAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
});
