import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
const LogoImg = require('../../../assets/logo.png') as number;
const BUTTON_SHINE_WIDTH = 86;

export function useLoopingAnimation(duration: number, delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
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
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return progress;
}


export function AnimatedBackground() {
  const glowOne = useLoopingAnimation(6200);
  const glowTwo = useLoopingAnimation(7800, 450);
  const glowThree = useLoopingAnimation(8600, 900);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.cornerGlow,
          {
            opacity: glowOne.interpolate({
              inputRange: [0, 1],
              outputRange: [0.055, 0.085],
            }),
            transform: [
              {
                scale: glowOne.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.08],
                }),
              },
              {
                translateX: glowOne.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -8],
                }),
              },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.bottomGlow,
          {
            opacity: glowTwo.interpolate({
              inputRange: [0, 1],
              outputRange: [0.04, 0.07],
            }),
            transform: [
              {
                scale: glowTwo.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.06],
                }),
              },
              {
                translateY: glowTwo.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -12],
                }),
              },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.logoHaloBack,
          {
            opacity: glowThree.interpolate({
              inputRange: [0, 1],
              outputRange: [0.04, 0.075],
            }),
            transform: [
              {
                scale: glowThree.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1.05],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}


export function BrandHeader() {
  const { t: translateUi } = useLanguage();
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useLoopingAnimation(5600, 250);

  useEffect(() => {
    Animated.timing(entrance, {
      duration: 640,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.hero,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.logoAura}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.logoPulseRing,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.28, 0.58],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1.12],
                  }),
                },
              ],
            },
          ]}
        />
        <View style={styles.logoGlow}>
          <Image resizeMode="contain" source={LogoImg} style={styles.logoImg} />
        </View>
      </View>
      <Text style={styles.brandName}>VALO</Text>
      <Text style={styles.brandSub}>PARKING</Text>
      <View style={styles.badge}>
        <Ionicons name="flash" size={11} color={BRAND.gold} />
        <Text style={styles.badgeText}>{translateUi("Smart Parking Platform")}</Text>
      </View>
    </Animated.View>
  );
}


export function PrimaryButton({
  title,
  loading,
  disabled,
  onPress,
}: {
  title: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const isDisabled = disabled || loading;
  const press = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    shine.setValue(0);
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(shine, {
        duration: 900,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shine, title]);

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 14,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.98],
  });
  const arrowTranslate = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 4],
  });
  const shineTranslate = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-BUTTON_SHINE_WIDTH, 360],
  });

  return (
    <Animated.View
      style={[
        styles.primaryBtn,
        isDisabled && styles.disabled,
        {
          transform: [{ scale }],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: isDisabled }}
        disabled={isDisabled}
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
      >
        <LinearGradient
          colors={[BRAND.goldLight, BRAND.gold, BRAND.goldDark]}
          end={{ x: 1, y: 0 }}
          start={{ x: 0, y: 0 }}
          style={styles.primaryBtnGrad}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.buttonShine,
              {
                transform: [{ translateX: shineTranslate }, { rotate: '18deg' }],
              },
            ]}
          />
          {loading ? (
            <ActivityIndicator color={COLORS.textInverse} size="small" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>{title}</Text>
              <Animated.View style={{ transform: [{ translateX: arrowTranslate }] }}>
                <Ionicons name="arrow-forward" size={18} color={COLORS.textInverse} />
              </Animated.View>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}


export function AuthCard({ children }: { children: ReactNode }) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      delay: 180,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={[BRAND.gold, 'rgba(244,197,66,0.06)', 'transparent']}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.cardTopLine}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.045)', 'rgba(255,255,255,0)', 'rgba(244,197,66,0.035)']}
        pointerEvents="none"
        style={styles.cardWash}
      />
      <View pointerEvents="none" style={styles.cardInnerGlow} />
      {children}
    </Animated.View>
  );
}

export const BRAND = {
  background: COLORS.background,
  card: COLORS.surface,
  gold: COLORS.gold,
  goldLight: COLORS.goldLight,
  goldDark: COLORS.goldDark,
  border: COLORS.border,
};



const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BRAND.background,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingTop: 64,
    paddingBottom: SPACING.lg,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  logoHaloBack: {
    backgroundColor: BRAND.gold,
    borderRadius: 120,
    height: 240,
    left: '50%',
    marginLeft: -120,
    position: 'absolute',
    top: 72,
    width: 240,
  },
  cornerGlow: {
    backgroundColor: BRAND.gold,
    borderRadius: 130,
    height: 260,
    opacity: 0.06,
    position: 'absolute',
    right: -90,
    top: -70,
    width: 260,
  },
  bottomGlow: {
    backgroundColor: BRAND.goldDark,
    borderRadius: 150,
    bottom: -150,
    height: 300,
    left: -120,
    opacity: 0.045,
    position: 'absolute',
    width: 300,
  },
  hero: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  logoAura: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.05)',
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    width: 96,
  },
  logoPulseRing: {
    borderColor: 'rgba(244,197,66,0.55)',
    borderRadius: 48,
    borderWidth: 1,
    height: 96,
    position: 'absolute',
    width: 96,
  },
  logoGlow: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.08)',
    borderColor: 'rgba(244,197,66,0.28)',
    borderRadius: 42,
    borderWidth: 1,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  logoImg: {
    height: 62,
    width: 62,
  },
  brandName: {
    ...typography.h1,
    color: BRAND.gold,
    letterSpacing: 0,
  },
  brandSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: -2,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.1)',
    borderColor: 'rgba(244,197,66,0.22)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginTop: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    color: BRAND.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  card: {
    backgroundColor: BRAND.card,
    borderColor: BRAND.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  cardWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 600,
  },
  cardTopLine: {
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cardInnerGlow: {
    backgroundColor: 'rgba(244,197,66,0.04)',
    borderRadius: 140,
    height: 280,
    position: 'absolute',
    right: -170,
    top: -155,
    width: 280,
  },
  segmented: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: BRAND.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    marginBottom: SPACING.lg,
    padding: 4,
  },
  segmentIndicator: {
    backgroundColor: BRAND.gold,
    borderRadius: 14,
    bottom: 4,
    left: 4,
    position: 'absolute',
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    top: 4,
  },
  segmentButtonWrap: {
    flex: 1,
    zIndex: 1,
  },
  segmentButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  segmentLabelActive: {
    color: COLORS.textInverse,
  },
  cardTitle: {
    ...typography.h2,
    color: COLORS.textPrimary,
    marginBottom: 5,
  },
  cardSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  inputBlock: {
    marginBottom: 12,
    position: 'relative',
  },
  inputLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    marginBottom: 7,
  },
  fieldGlow: {
    backgroundColor: BRAND.gold,
    borderRadius: RADIUS.lg,
    bottom: 0,
    left: -2,
    position: 'absolute',
    right: -2,
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    top: 23,
  },
  fieldWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: SPACING.sm,
  },
  fieldFocused: {
    backgroundColor: 'rgba(244,197,66,0.075)',
    borderColor: 'rgba(244,197,66,0.65)',
  },
  fieldError: {
    borderColor: COLORS.error,
  },
  fieldDisabled: {
    opacity: 0.62,
  },
  fieldIconLeft: {
    alignItems: 'center',
    width: 34,
  },
  fieldIconRight: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    minHeight: 44,
  },
  fieldInput: {
    ...typography.body1,
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    minHeight: 52,
    paddingVertical: 12,
    minWidth: 0,
  },
  inputErrorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.xs,
    marginTop: 5,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: SPACING.md,
    marginTop: -2,
  },
  forgotPress: {
    borderRadius: RADIUS.round,
    paddingHorizontal: 8,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  forgotText: {
    color: BRAND.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  primaryBtn: {
    borderRadius: RADIUS.lg,
    marginTop: 2,
    overflow: 'hidden',
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  primaryPressed: {
    transform: [{ scale: 0.985 }],
  },
  primaryBtnGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 54,
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  buttonShine: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    bottom: -20,
    position: 'absolute',
    top: -20,
    width: BUTTON_SHINE_WIDTH,
  },
  primaryBtnText: {
    ...typography.button,
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    flexShrink: 1,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginVertical: SPACING.md,
  },
  dividerLine: {
    backgroundColor: BRAND.border,
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginHorizontal: SPACING.sm,
  },
  googleBtnWrap: {
    borderRadius: RADIUS.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  googleBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E6E6',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  googleBtnPressed: {
    backgroundColor: '#F8F8F8',
  },
  googleBtnText: {
    color: '#303134',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  formError: {
    alignItems: 'center',
    backgroundColor: COLORS.errorTint,
    borderColor: COLORS.error,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  formErrorText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    textAlign: 'left',
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
});

export { styles as authStyles };
