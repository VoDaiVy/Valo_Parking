import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchProfile, type Profile } from '../../api/profile.api';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { subscriptionsService } from '@/services/api/subscriptions';
import { walletService } from '@/services/api/wallet';
import type { MembershipStatus } from '@/types/subscription.types';
import { formatCurrency, formatDate } from '@/utils/formatters';

type QuickAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  screen?: string;
  params?: Record<string, unknown>;
};

type ActionButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  variant: 'primary' | 'secondary';
  onPress: () => void;
};

type HeroMetric = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: 'gold' | 'green' | 'neutral';
};

type HeroCarouselItem = {
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
  kicker: string;
  title: string;
  body: string;
};

const GOLD_BORDER = 'rgba(226,186,75,0.28)';
const SOFT_BORDER = 'rgba(255,255,255,0.08)';
const SURFACE_GLASS = 'rgba(255,255,255,0.06)';
const BUTTON_SHINE_WIDTH = 86;
const PREMIUM = {
  background: '#090A0C',
  surface: '#141518',
  surfaceElevated: '#1A1B20',
  glass: 'rgba(255,255,255,0.065)',
};

const QUICK_ACTIONS: QuickAction[] = [
  { icon: 'calendar-outline', label: 'My bookings', description: 'Reservations & QR', screen: 'Bookings', params: { screen: 'BookingList' } },
  { icon: 'gift-outline', label: 'Voucher', description: 'Rewards & spending', screen: 'WalletTab', params: { screen: 'Rewards' } },
  {
    icon: 'car-outline',
    label: 'My vehicles',
    description: 'Manage license plates',
    screen: 'ProfileTab',
    params: { screen: 'VehicleList' },
  },
  {
    icon: 'wallet-outline',
    label: 'VALO Wallet',
    description: 'Top up and view balance',
    screen: 'WalletTab',
    params: { screen: 'Wallet' },
  },
  {
    icon: 'receipt-outline',
    label: 'History',
    description: 'Past parking sessions',
    screen: 'ProfileTab',
    params: { screen: 'ParkingHistory' },
  },
  {
    icon: 'ribbon-outline',
    label: 'Membership',
    description: 'Member benefits',
    screen: 'WalletTab',
    params: { screen: 'Membership' },
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function useLoopingPulse(duration: number, delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        duration,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        duration,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return progress;
}

function useEntranceValue(delay: number, duration = 520) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      delay,
      duration,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, duration, progress]);

  return progress;
}

function useBalanceReveal(value: number | null) {
  const [displayValue, setDisplayValue] = useState(value ?? 0);
  const progress = useRef(new Animated.Value(1)).current;
  const previousValue = useRef(value ?? 0);

  useEffect(() => {
    if (value === null || value === previousValue.current) return;

    const from = previousValue.current;
    const to = value;
    previousValue.current = to;
    progress.setValue(0);

    const listener = progress.addListener(({ value: animatedValue }) => {
      setDisplayValue(Math.round(from + (to - from) * animatedValue));
    });

    Animated.timing(progress, {
      duration: 520,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: false,
    }).start(({ finished }) => {
      progress.removeListener(listener);
      if (finished) setDisplayValue(to);
    });

    return () => progress.removeListener(listener);
  }, [progress, value]);

  return value === null ? null : displayValue;
}

function AnimatedPressable({
  children,
  style,
  onPress,
  accessibilityLabel,
  pressedScale = 0.96,
  tilt = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
  accessibilityLabel?: string;
  pressedScale?: number;
  tilt?: boolean;
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
    outputRange: [1, pressedScale],
  });
  const rotate = press.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', tilt ? '-1.4deg' : '0deg'],
  });

  return (
    <Animated.View style={[style, { transform: [{ scale }, { rotate }] }]}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function BackgroundGlow({ scrollY }: { scrollY: Animated.Value }) {
  const topGlow = useLoopingPulse(8200);
  const lowerGlow = useLoopingPulse(7600, 850);

  const parallax = scrollY.interpolate({
    inputRange: [0, 240],
    outputRange: [0, -22],
    extrapolate: 'clamp',
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.backgroundGlowTop,
          {
            opacity: topGlow.interpolate({
              inputRange: [0, 1],
              outputRange: [0.18, 0.34],
            }),
            transform: [
              {
                scale: topGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.98, 1.07],
                }),
              },
              { translateY: parallax },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.backgroundGlowLower,
          {
            opacity: lowerGlow.interpolate({
              inputRange: [0, 1],
              outputRange: [0.1, 0.2],
            }),
            transform: [
              {
                scale: lowerGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.06],
                }),
              },
            ],
          },
        ]}
      />
      <View style={styles.backgroundArcOne} />
      <View style={styles.backgroundLineOne} />
    </View>
  );
}

function HomeHeader({
  displayName,
  initial,
  avatarUri,
  entrance,
  scrollY,
  onNotificationsPress,
  onAvatarPress,
}: {
  displayName: string;
  initial: string;
  avatarUri: string | null;
  entrance: Animated.Value;
  scrollY: Animated.Value;
  onNotificationsPress: () => void;
  onAvatarPress: () => void;
}) {
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
                outputRange: [16, 0],
              }),
            },
            {
              scale: scrollY.interpolate({
                inputRange: [0, 180],
                outputRange: [1, 0.985],
                extrapolate: 'clamp',
              }),
            },
          ],
        },
      ]}
    >
      <View pointerEvents="none" style={styles.headerHalo} />
      <View style={styles.headerLeft}>
        <Text style={styles.greeting}>{getGreeting()},</Text>
        <Text style={styles.userName} numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      <View style={styles.headerRight}>
        <AnimatedPressable
          accessibilityLabel="Open notifications"
          onPress={onNotificationsPress}
          pressedScale={0.94}
          style={styles.headerIconBtn}
        >
          <Ionicons name="notifications-outline" size={22} color={COLORS.textPrimary} />
        </AnimatedPressable>

        <AnimatedPressable
          accessibilityLabel="Open account"
          onPress={onAvatarPress}
          pressedScale={0.94}
          style={styles.avatarShell}
        >
          <LinearGradient
            colors={[COLORS.goldLight, 'rgba(255,255,255,0.16)', COLORS.gold]}
            style={styles.avatarRing}
          >
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
          </LinearGradient>
        </AnimatedPressable>
      </View>
    </Animated.View>
  );
}

function HomeActionButton({ icon, label, variant, onPress }: ActionButtonProps) {
  const press = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    shine.setValue(0);
    Animated.sequence([
      Animated.delay(780),
      Animated.timing(shine, {
        duration: 880,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shine, label]);

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 15,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();

    if (toValue === 1) {
      ripple.setValue(0);
      Animated.timing(ripple, {
        duration: 440,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start();
    }
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.975],
  });
  const rotate = press.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', variant === 'primary' ? '-0.9deg' : '0.9deg'],
  });
  const iconTranslate = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 4],
  });
  const shineTranslate = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-BUTTON_SHINE_WIDTH, 320],
  });
  const rippleScale = ripple.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1.9],
  });

  return (
    <Animated.View
      style={[
        variant === 'primary' ? styles.primaryActionShell : styles.secondaryActionShell,
        { transform: [{ scale }, { rotate }] },
      ]}
    >
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
      >
        {variant === 'primary' ? (
          <LinearGradient
            colors={COLORS.gradientGold}
            end={{ x: 1, y: 0 }}
            start={{ x: 0, y: 0 }}
            style={styles.primaryAction}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.actionRipple,
                {
                  opacity: ripple.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.32, 0],
                  }),
                  transform: [{ scale: rippleScale }],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.buttonShine,
                { transform: [{ translateX: shineTranslate }, { rotate: '18deg' }] },
              ]}
            />
            <Ionicons name={icon} size={18} color={COLORS.textInverse} />
            <Text numberOfLines={1} style={styles.primaryActionText}>
              {label}
            </Text>
            <Animated.View style={{ transform: [{ translateX: iconTranslate }] }}>
              <Ionicons name="arrow-forward" size={17} color={COLORS.textInverse} />
            </Animated.View>
          </LinearGradient>
        ) : (
          <View style={styles.secondaryAction}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.actionRipple,
                {
                  opacity: ripple.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.18, 0],
                  }),
                  transform: [{ scale: rippleScale }],
                },
              ]}
            />
            <Ionicons name={icon} size={18} color={COLORS.gold} />
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.secondaryActionText}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function HeroMetricTile({ metric, index }: { metric: HeroMetric; index: number }) {
  const entrance = useEntranceValue(480 + index * 90, 460);
  const accentColor = metric.tone === 'neutral' ? COLORS.textSecondary : COLORS.gold;

  return (
    <Animated.View
      style={[
        styles.metricTile,
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
      <LinearGradient
        colors={['rgba(255,255,255,0.065)', 'rgba(226,186,75,0.035)']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.metricIcon, { borderColor: `${accentColor}55` }]}>
        <Ionicons name={metric.icon} size={16} color={accentColor} />
      </View>
      <Text numberOfLines={1} style={styles.metricLabel}>
        {metric.label}
      </Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>
        {metric.value}
      </Text>
    </Animated.View>
  );
}

const HERO_CAROUSEL_ITEMS: HeroCarouselItem[] = [
  {
    accent: COLORS.gold,
    body: 'Reserve earlier, arrive calmer, and keep every parking step in one place.',
    icon: 'sparkles-outline',
    kicker: 'Service promotion',
    title: 'Premium care, ready before arrival',
  },
  {
    accent: COLORS.gold,
    body: 'Priority access and monthly benefits for drivers who park often.',
    icon: 'ribbon-outline',
    kicker: 'Membership',
    title: 'Unlock a smoother VALO routine',
  },
  {
    accent: COLORS.gold,
    body: 'Check live availability before leaving and avoid circling for a space.',
    icon: 'navigate-outline',
    kicker: 'Parking tips',
    title: 'Plan the fastest arrival window',
  },
];

function HeroCarousel({ width }: { width: number }) {
  const pageWidth = width;
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (dragging.current) return;
      const nextIndex = (activeIndex + 1) % HERO_CAROUSEL_ITEMS.length;
      scrollRef.current?.scrollTo({ animated: true, x: nextIndex * pageWidth });
      setActiveIndex(nextIndex);
    }, 4500);

    return () => clearInterval(interval);
  }, [activeIndex, pageWidth]);

  return (
    <StaggeredCarouselShell>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        decelerationRate="fast"
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        snapToInterval={pageWidth}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
          setActiveIndex(Math.max(0, Math.min(HERO_CAROUSEL_ITEMS.length - 1, nextIndex)));
          dragging.current = false;
        }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: false,
        })}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
      >
        {HERO_CAROUSEL_ITEMS.map((item, index) => {
          const inputRange = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.96, 1, 0.96],
            extrapolate: 'clamp',
          });
          const translateX = scrollX.interpolate({
            inputRange,
            outputRange: [14, 0, -14],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View key={item.title} style={[styles.carouselPage, { width: pageWidth, transform: [{ scale }] }]}>
              <LinearGradient
                colors={['rgba(255,255,255,0.055)', 'rgba(226,186,75,0.045)', 'rgba(255,255,255,0.018)']}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.carouselCard}
              >
                <View style={[styles.carouselIcon, { backgroundColor: `${item.accent}18` }]}>
                  <Ionicons name={item.icon} size={19} color={item.accent} />
                </View>
                <Animated.View style={[styles.carouselCopy, { transform: [{ translateX }] }]}>
                  <Text style={[styles.carouselKicker, { color: item.accent }]}>{item.kicker}</Text>
                  <Text numberOfLines={2} style={styles.carouselTitle}>{item.title}</Text>
                  <Text numberOfLines={2} style={styles.carouselBody}>{item.body}</Text>
                </Animated.View>
              </LinearGradient>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      <View style={styles.carouselDots}>
        {HERO_CAROUSEL_ITEMS.map((item, index) => {
          const widthAnim = scrollX.interpolate({
            inputRange: [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth],
            outputRange: [6, 22, 6],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={item.title}
              style={[
                styles.carouselDot,
                {
                  backgroundColor: activeIndex === index ? item.accent : 'rgba(255,255,255,0.18)',
                  width: widthAnim,
                },
              ]}
            />
          );
        })}
      </View>
    </StaggeredCarouselShell>
  );
}

function StaggeredCarouselShell({ children }: { children: ReactNode }) {
  const entrance = useEntranceValue(620, 460);
  return (
    <Animated.View
      style={[
        styles.carouselShell,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
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

function PremiumHeroDashboard({
  isCompact,
  entrance,
  scrollY,
  title,
  balance,
  activeMembership,
  onFindPress,
  onBookPress,
}: {
  isCompact: boolean;
  entrance: Animated.Value;
  scrollY: Animated.Value;
  title: string;
  balance: string;
  activeMembership: MembershipStatus | null;
  onFindPress: () => void;
  onBookPress: () => void;
}) {
  const metrics = useMemo<HeroMetric[]>(() => {
    return [
      { icon: 'wallet-outline', label: 'Wallet', value: balance },
      { icon: 'navigate-outline', label: 'Parking', value: 'Open 24/7', tone: 'neutral' },
    ];
  }, [balance]);

  return (
    <Animated.View
      style={[
        styles.heroDashboard,
        {
          opacity: entrance,
          transform: [
            {
              translateY: Animated.add(
                entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [26, 0],
                }),
                scrollY.interpolate({
                  inputRange: [0, 240],
                  outputRange: [0, -10],
                  extrapolate: 'clamp',
                }),
              ),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.965, 1],
              }),
            },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={['#222017', '#14161A', '#0B0C0E']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.105)', 'rgba(255,255,255,0)', 'rgba(226,186,75,0.1)']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[COLORS.goldLight, COLORS.gold, 'transparent']}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.heroTopLine}
      />
      <View pointerEvents="none" style={styles.heroGoldOrb} />
      <View pointerEvents="none" style={styles.heroGridOne} />
      <View pointerEvents="none" style={styles.heroGridTwo} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.heroLightSweep,
          {
            transform: [
              {
                translateX: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-130, 390],
                }),
              },
              { rotate: '16deg' },
            ],
          },
        ]}
      />

      <View style={[styles.heroContent, isCompact && styles.heroContentCompact]}>
        <View style={styles.heroIdentityRow}>
          <View style={styles.heroIdentityMark}>
            <Ionicons name="car-sport-outline" size={22} color={COLORS.gold} />
          </View>
          <View style={styles.heroTitleWrap}>
            <Text style={[styles.heroTitle, isCompact && styles.heroTitleCompact]}>{title}</Text>
          </View>
        </View>

        <View style={[styles.metricGrid, isCompact && styles.metricGridCompact]}>
          {metrics.map((metric, index) => (
            <React.Fragment key={`${metric.label}-${metric.value}`}>
              <HeroMetricTile metric={metric} index={index} />
              {index < metrics.length - 1 ? <View style={styles.metricSeparator} /> : null}
            </React.Fragment>
          ))}
        </View>

        {activeMembership ? (
          <View style={styles.heroMembershipStrip}>
            <View style={styles.heroMembershipDot} />
            <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.gold} />
            <Text numberOfLines={1} style={styles.heroMembershipText}>
              {activeMembership.package?.type === 'yearly' ? 'Annual member' : 'Monthly member'}
              {activeMembership.expireAt ? ` · Expires ${formatDate(activeMembership.expireAt)}` : ''}
            </Text>
          </View>
        ) : null}

        <View style={[styles.heroActions, isCompact && styles.heroActionsCompact]}>
          <HomeActionButton icon="navigate" label="Find Parking" variant="primary" onPress={onFindPress} />
          <HomeActionButton icon="calendar-outline" label="Book Now" variant="secondary" onPress={onBookPress} />
        </View>
      </View>
    </Animated.View>
  );
}

function QuickAccessCard({
  action,
  index,
  grid,
  onPress,
}: {
  action: QuickAction;
  index: number;
  grid: boolean;
  onPress: () => void;
}) {
  const entrance = useEntranceValue(720 + index * 90, 440);
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

  const iconScale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const iconRotate = press.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '4deg'],
  });
  const chevronTranslate = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 4],
  });

  return (
    <Animated.View
      style={[
        grid ? styles.quickGridCell : styles.quickListCell,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
            {
              scale: press.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.985],
              }),
            },
            {
              rotate: press.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', grid ? '-0.8deg' : '-0.4deg'],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`${action.label}. ${action.description}`}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
        style={({ pressed }) => [
          styles.quickListTile,
          pressed && styles.quickTilePressed,
        ]}
      >
        <Animated.View
          style={[
            styles.quickIconWrap,
            {
              transform: [{ scale: iconScale }, { rotate: iconRotate }],
            },
          ]}
        >
          <Ionicons name={action.icon} size={20} color={COLORS.gold} />
        </Animated.View>
        <View style={styles.quickCopy}>
          <Text numberOfLines={1} style={styles.quickLabel}>
            {action.label}
          </Text>
          <Text numberOfLines={grid ? 2 : 1} style={styles.quickDescription}>
            {action.description}
          </Text>
        </View>
        <Animated.View style={[styles.quickIndicator, { transform: [{ translateX: chevronTranslate }] }]}>
          <Ionicons name="arrow-forward" size={14} color={COLORS.gold} />
        </Animated.View>
      </Pressable>
      <View style={styles.quickDivider} />
    </Animated.View>
  );
}

function QuickAccessSection({ navigation }: { navigation?: any }) {
  return (
    <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>Feature control</Text>
          <Text style={styles.sectionTitle}>Quick access</Text>
        </View>
        <View style={styles.sectionLine} />
      </View>
      <View style={styles.quickList}>
        {QUICK_ACTIONS.map((action, index) => (
          <QuickAccessCard
            action={action}
            grid={false}
            index={index}
            key={action.label}
            onPress={() => navigation?.navigate?.(action.screen ?? 'Home', action.params)}
          />
        ))}
      </View>
    </>
  );
}

function MembershipCard({
  activeMembership,
  entrance,
  onPress,
}: {
  activeMembership: MembershipStatus;
  entrance: Animated.Value;
  onPress: () => void;
}) {
  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [14, 0],
            }),
          },
        ],
      }}
    >
      <AnimatedPressable
        accessibilityLabel="View membership details and assigned VIP spaces"
        onPress={onPress}
        pressedScale={0.985}
        style={styles.membershipCard}
      >
        <SectionLabel title="Membership" />
        <View style={styles.membershipTopRow}>
          <View style={styles.membershipIdentity}>
            <View style={styles.membershipIcon}>
              <Ionicons name="ribbon" size={20} color={COLORS.gold} />
            </View>
            <View style={styles.membershipTitleWrap}>
              <Text style={styles.membershipEyebrow}>
                {activeMembership.package?.type === 'yearly' ? 'Annual member' : 'Monthly member'}
              </Text>
              <Text numberOfLines={1} style={styles.membershipName}>
                {activeMembership.package?.name ?? 'VALO Membership'}
              </Text>
            </View>
          </View>
          <View style={styles.membershipActivePill}>
            <View style={styles.membershipActiveDot} />
            <Text style={styles.membershipActiveText}>Active</Text>
          </View>
        </View>

        <View style={styles.membershipDivider} />

        <View style={styles.vipSlotHeader}>
          <Text style={styles.vipSlotLabel}>Assigned VIP spaces</Text>
          {activeMembership.expireAt ? (
            <Text style={styles.membershipExpiry}>Expires {formatDate(activeMembership.expireAt)}</Text>
          ) : null}
        </View>
        {activeMembership.reservedSlots.length > 0 ? (
          <View style={styles.vipSlotList}>
            {activeMembership.reservedSlots.map((slot) => (
              <View key={`${slot.floorId}-${slot.slotCode}`} style={styles.vipSlotPill}>
                <Ionicons name="location" size={15} color={COLORS.gold} />
                <Text style={styles.vipSlotCode}>{slot.slotCode}</Text>
                <Text numberOfLines={1} style={styles.vipSlotFloor}>
                  {' - '}
                  {slot.floorName || `Floor ${slot.floorNumber ?? '--'}`}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.vipSlotPending}>
            <Ionicons name="time-outline" size={16} color={COLORS.warning} />
            <Text style={styles.vipSlotPendingText}>
              Your plan is active. VIP space assignment is pending.
            </Text>
          </View>
        )}

        <View style={styles.membershipFooter}>
          <Text style={styles.membershipFooterText}>View membership benefits</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.gold} />
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

function InfoBanner({ entrance }: { entrance: Animated.Value }) {
  return (
    <Animated.View
      style={[
        styles.infoBanner,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.infoIcon}>
        <Ionicons name="information-circle-outline" size={20} color={COLORS.gold} />
      </View>
      <Text style={styles.infoBannerText}>Open 24/7 · Reserve faster, arrive calmer.</Text>
    </Animated.View>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <View style={styles.inlineSectionLabel}>
      <Text style={styles.inlineSectionText}>{title}</Text>
      <View style={styles.inlineSectionRule} />
    </View>
  );
}

export default function HomeScreen({ navigation }: { navigation?: any }) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerEntrance = useEntranceValue(80);
  const heroEntrance = useEntranceValue(230);
  const membershipEntrance = useEntranceValue(640);
  const infoEntrance = useEntranceValue(1080);

  const loadProfile = useCallback(async () => {
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch {
      // silently fail - show data from auth context
    }
  }, []);

  const loadWallet = useCallback(async () => {
    try {
      const res = await walletService.getWallet();
      if (res?.data?.balance !== undefined) {
        setWalletBalance(res.data.balance);
      }
    } catch {
      // silently fail
    }
  }, []);

  const loadMembership = useCallback(async () => {
    try {
      const response = await subscriptionsService.getMembership();
      setMembership(response.data || null);
    } catch {
      // Keep the home screen usable when membership data is temporarily unavailable.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
      void loadWallet();
      void loadMembership();
    }, [loadMembership, loadProfile, loadWallet]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadWallet(), loadMembership()]);
    setRefreshing(false);
  };

  const isCompact = width < 370;
  const displayName = profile?.fullName || user?.username || 'Customer';
  const initial = displayName.charAt(0).toUpperCase();
  const avatarUri = profile?.avatar || null;
  const activeMembership = membership?.status === 'active' && membership.isVip ? membership : null;
  const animatedBalance = useBalanceReveal(walletBalance);
  const formattedBalance = useMemo(
    () => (animatedBalance !== null ? formatCurrency(animatedBalance) : 'Not loaded'),
    [animatedBalance],
  );
  const heroTitle = isCompact
    ? 'Your parking, ready when you are.'
    : 'Your parking space, ready when you are.';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={PREMIUM.background} />
      <LinearGradient
        colors={[PREMIUM.background, '#101113', '#0B0C0E']}
        locations={[0, 0.54, 1]}
        style={StyleSheet.absoluteFill}
      />
      <BackgroundGlow scrollY={scrollY} />

      <Animated.ScrollView
        contentContainerStyle={[styles.scroll, isCompact && styles.scrollCompact]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        refreshControl={
          <RefreshControl
            colors={[COLORS.gold]}
            refreshing={refreshing}
            tintColor={COLORS.gold}
            onRefresh={onRefresh}
          />
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <HomeHeader
          avatarUri={avatarUri}
          displayName={displayName}
          entrance={headerEntrance}
          initial={initial}
          scrollY={scrollY}
          onAvatarPress={() => navigation?.navigate?.('ProfileTab', { screen: 'Profile' })}
          onNotificationsPress={() => navigation?.navigate?.('NotificationsTab')}
        />

        <PremiumHeroDashboard
          activeMembership={activeMembership}
          balance={formattedBalance}
          entrance={heroEntrance}
          isCompact={isCompact}
          scrollY={scrollY}
          title={heroTitle}
          onBookPress={() => navigation?.navigate?.('Bookings', { screen: 'CreateBooking' })}
          onFindPress={() => navigation?.navigate?.('Bookings', { screen: 'FindParking' })}
        />

        <HeroCarousel width={width} />

        <QuickAccessSection navigation={navigation} />

        {activeMembership ? (
          <MembershipCard
            activeMembership={activeMembership}
            entrance={membershipEntrance}
            onPress={() => navigation?.navigate?.('WalletTab', { screen: 'Membership' })}
          />
        ) : null}

        <InfoBanner entrance={infoEntrance} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PREMIUM.background,
  },
  scroll: {
    paddingBottom: 104,
    paddingTop: SPACING.sm,
  },
  scrollCompact: {
    paddingBottom: 96,
  },
  backgroundGlowTop: {
    backgroundColor: COLORS.gold,
    borderRadius: 180,
    height: 280,
    position: 'absolute',
    right: -150,
    top: -120,
    opacity: 0.12,
    width: 280,
  },
  backgroundGlowLower: {
    backgroundColor: COLORS.gold,
    borderRadius: 150,
    height: 250,
    position: 'absolute',
    right: -170,
    top: 560,
    width: 250,
  },
  backgroundArcOne: {
    borderColor: 'rgba(226,186,75,0.055)',
    borderRadius: 80,
    borderWidth: 1,
    height: 126,
    position: 'absolute',
    right: -52,
    top: 210,
    transform: [{ rotate: '-14deg' }],
    width: 210,
  },
  backgroundLineOne: {
    backgroundColor: 'rgba(226,186,75,0.045)',
    height: 1,
    left: 26,
    position: 'absolute',
    right: 36,
    top: 352,
    transform: [{ rotate: '-8deg' }],
  },
  pressed: {
    opacity: 0.8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  headerHalo: {
    backgroundColor: 'rgba(226,186,75,0.11)',
    borderRadius: 80,
    height: 94,
    position: 'absolute',
    right: 6,
    top: -10,
    width: 190,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: SPACING.md,
  },
  greeting: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  userName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  headerIconBtn: {
    alignItems: 'center',
    backgroundColor: SURFACE_GLASS,
    borderColor: SOFT_BORDER,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    width: 44,
  },
  avatarShell: {
    height: 46,
    width: 46,
  },
  avatarRing: {
    alignItems: 'center',
    borderRadius: 23,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.055)',
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 40,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: COLORS.goldLight,
    fontSize: FONT_SIZES.md,
    fontWeight: '900',
  },
  heroDashboard: {
    borderColor: GOLD_BORDER,
    borderRadius: 24,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
  },
  heroTopLine: {
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  heroGoldOrb: {
    backgroundColor: 'rgba(226,186,75,0.18)',
    borderRadius: 140,
    height: 210,
    position: 'absolute',
    right: -146,
    top: -136,
    width: 210,
  },
  heroGridOne: {
    borderColor: 'rgba(226,186,75,0.09)',
    borderRadius: 34,
    borderWidth: 1,
    height: 70,
    position: 'absolute',
    right: -22,
    top: 62,
    transform: [{ rotate: '-10deg' }],
    width: 144,
  },
  heroGridTwo: {
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 26,
    borderWidth: 1,
    bottom: 52,
    height: 64,
    left: -36,
    position: 'absolute',
    transform: [{ rotate: '12deg' }],
    width: 134,
  },
  heroLightSweep: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    bottom: -56,
    position: 'absolute',
    top: -56,
    width: 92,
  },
  heroContent: {
    padding: SPACING.md,
  },
  heroContentCompact: {
    padding: SPACING.md,
  },
  heroTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },
  floatingBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(226,186,75,0.22)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 5,
    minHeight: 28,
    paddingHorizontal: SPACING.sm,
  },
  floatingBadgeText: {
    color: COLORS.textSecondary,
    flexShrink: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  heroIdentityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  heroIdentityMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderColor: 'rgba(226,186,75,0.28)',
    borderRadius: 20,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    width: 44,
  },
  heroTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: COLORS.textPrimary,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 29,
  },
  heroTitleCompact: {
    fontSize: 23,
    lineHeight: 27,
  },
  metricGrid: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: 'rgba(255,255,255,0.075)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 0,
    marginTop: SPACING.sm,
    minHeight: 58,
    overflow: 'hidden',
  },
  metricGridCompact: {
    minHeight: 56,
  },
  metricTile: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 58,
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
  },
  metricIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderRadius: 12,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  metricLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  metricValue: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
    marginLeft: 'auto',
    maxWidth: 92,
    textAlign: 'right',
  },
  metricSeparator: {
    backgroundColor: 'rgba(226,186,75,0.22)',
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  heroMembershipStrip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: SPACING.sm,
    minHeight: 24,
  },
  heroMembershipDot: {
    backgroundColor: '#67C587',
    borderRadius: 3,
    height: 6,
    opacity: 0.8,
    width: 6,
  },
  heroMembershipText: {
    color: COLORS.goldLight,
    flex: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  heroActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  heroActionsCompact: {
    flexDirection: 'column',
  },
  primaryActionShell: {
    borderRadius: RADIUS.lg,
    flex: 1.55,
    minWidth: 0,
    overflow: 'hidden',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.27,
    shadowRadius: 18,
  },
  secondaryActionShell: {
    borderRadius: RADIUS.lg,
    flex: 0.9,
    minWidth: 116,
    overflow: 'hidden',
  },
  primaryAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
  },
  primaryActionText: {
    color: COLORS.textInverse,
    fontSize: 16,
    fontWeight: '800',
    minWidth: 0,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: GOLD_BORDER,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 48,
    overflow: 'hidden',
    paddingHorizontal: SPACING.sm,
  },
  secondaryActionText: {
    color: COLORS.gold,
    flexShrink: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
    minWidth: 0,
  },
  buttonShine: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    bottom: -18,
    position: 'absolute',
    top: -18,
    width: BUTTON_SHINE_WIDTH,
  },
  actionRipple: {
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderRadius: 60,
    height: 92,
    position: 'absolute',
    width: 92,
  },
  membershipCard: {
    borderBottomColor: SOFT_BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: SOFT_BORDER,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    paddingBottom: SPACING.md,
    paddingTop: SPACING.md,
  },
  membershipTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  membershipIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minWidth: 0,
  },
  membershipIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.09)',
    borderRadius: RADIUS.round,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  membershipTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  membershipEyebrow: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  membershipName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
    marginTop: 2,
  },
  membershipActivePill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginLeft: SPACING.sm,
  },
  membershipActiveDot: {
    backgroundColor: '#67C587',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  membershipActiveText: {
    color: COLORS.goldLight,
    fontSize: 10,
    fontWeight: '700',
  },
  membershipDivider: {
    backgroundColor: 'rgba(226,186,75,0.15)',
    height: 1,
    marginVertical: SPACING.md,
  },
  vipSlotHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  vipSlotLabel: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  membershipExpiry: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
  vipSlotList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  vipSlotPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    maxWidth: '100%',
    minHeight: 38,
    paddingHorizontal: SPACING.sm,
  },
  vipSlotCode: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.md,
    fontWeight: '900',
    marginLeft: 5,
  },
  vipSlotFloor: {
    color: COLORS.textSecondary,
    flexShrink: 1,
    fontSize: FONT_SIZES.xs,
    marginLeft: 3,
  },
  vipSlotPending: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.sm,
  },
  vipSlotPendingText: {
    color: COLORS.warning,
    flex: 1,
    fontSize: FONT_SIZES.xs,
    lineHeight: 17,
  },
  membershipFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: SPACING.md,
  },
  membershipFooterText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  sectionEyebrow: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '900',
    marginTop: 2,
  },
  sectionLine: {
    backgroundColor: 'rgba(226,186,75,0.18)',
    flex: 1,
    height: 1,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  quickList: {
    paddingHorizontal: SPACING.lg,
  },
  quickGridCell: {
    width: '48.7%',
  },
  quickListCell: {
    width: '100%',
  },
  quickTile: {
    backgroundColor: PREMIUM.surface,
    borderColor: SOFT_BORDER,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    minHeight: 120,
    overflow: 'hidden',
    padding: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  quickListTile: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 68,
    overflow: 'hidden',
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  quickTilePressed: {
    backgroundColor: 'rgba(226,186,75,0.045)',
  },
  quickIconWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderColor: 'rgba(226,186,75,0.24)',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  quickCopy: {
    flex: 1,
    minWidth: 0,
    marginTop: SPACING.xs,
  },
  quickLabel: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
  },
  quickDescription: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    lineHeight: 16,
    marginTop: 2,
  },
  quickIndicator: {
    alignItems: 'center',
    borderRadius: 14,
    height: 26,
    justifyContent: 'center',
    marginTop: SPACING.xs,
    width: 26,
  },
  quickDivider: {
    backgroundColor: SOFT_BORDER,
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
  },
  carouselShell: {
    marginTop: SPACING.md,
  },
  carouselPage: {
    paddingHorizontal: SPACING.lg,
  },
  carouselCard: {
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 116,
    overflow: 'hidden',
    padding: SPACING.md,
  },
  carouselIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.1)',
    borderRadius: RADIUS.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  carouselCopy: {
    flex: 1,
    minWidth: 0,
  },
  carouselKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  carouselTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 21,
    marginTop: 5,
  },
  carouselBody: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 5,
  },
  carouselDots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  carouselDot: {
    borderRadius: RADIUS.round,
    height: 6,
  },
  infoBanner: {
    alignItems: 'center',
    borderBottomColor: SOFT_BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: SOFT_BORDER,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    minHeight: 56,
    overflow: 'hidden',
    paddingVertical: SPACING.sm,
  },
  infoIcon: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  infoBannerText: {
    color: COLORS.textSecondary,
    flex: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    lineHeight: 18,
  },
  inlineSectionLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  inlineSectionText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  inlineSectionRule: {
    backgroundColor: 'rgba(226,186,75,0.18)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
