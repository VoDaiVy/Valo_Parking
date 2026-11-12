import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputProps,
  type ViewStyle,
  View,
} from 'react-native';

import { COLORS, CONTROL, FONT_SIZES, MOTION, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function useProfileEntrance(delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      delay,
      duration: MOTION.normal,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress]);

  return progress;
}

export function StaggeredView({
  children,
  delay = 0,
  distance = 8,
  style,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const entrance = useProfileEntrance(delay);

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
                outputRange: [distance, 0],
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

export function AnimatedPressable({
  accessibilityLabel,
  children,
  danger,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  style,
  tint = 'rgba(255,255,255,0.045)',
}: {
  accessibilityLabel?: string;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  style?: StyleProp<ViewStyle>;
  tint?: string;
}) {
  const scaleValue = useRef(new Animated.Value(0)).current;
  const tintValue = useRef(new Animated.Value(0)).current;

  const animatePress = (toValue: number) => {
    Animated.parallel([
      Animated.spring(scaleValue, {
        damping: 16,
        mass: 0.55,
        stiffness: 260,
        toValue,
        useNativeDriver: true,
      }),
      Animated.timing(tintValue, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
        toValue,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const scale = scaleValue.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });
  const backgroundColor = tintValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0)', danger ? 'rgba(255,77,77,0.09)' : tint],
  });

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Animated.View style={[styles.pressTint, { backgroundColor }]}>
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled) }}
          disabled={disabled}
          onPress={onPress}
          onPressIn={() => {
            animatePress(1);
            onPressIn?.();
          }}
          onPressOut={() => {
            animatePress(0);
            onPressOut?.();
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export function ProfileScreenHeader({
  onBack,
  right,
  subtitle,
  title,
}: {
  onBack?: () => void;
  right?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  const { t: translateUi } = useLanguage();
  const entrance = useProfileEntrance(20);
  const press = useRef(new Animated.Value(0)).current;

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 16,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

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
      {onBack ? (
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            accessibilityLabel={translateUi("Go back")}
            accessibilityRole="button"
            hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
            style={styles.backButton}
            onPress={onBack}
            onPressIn={() => animatePress(1)}
            onPressOut={() => animatePress(0)}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
          </Pressable>
        </Animated.View>
      ) : null}
      <View style={styles.headerCopy}>
        <Text numberOfLines={1} style={styles.headerTitle}>{translateUi(title)}</Text>
        {subtitle ? <Text numberOfLines={2} style={styles.headerSubtitle}>{translateUi(subtitle)}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </Animated.View>
  );
}

export function SectionHeader({ title }: { title: string }) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{translateUi(title)}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

export function ProfileDetailRow({
  icon,
  label,
  value,
}: {
  icon?: IconName;
  label: string;
  value?: string | null;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLabelWrap}>
        {icon ? <Ionicons name={icon} size={15} color={COLORS.textMuted} /> : null}
        <Text style={styles.detailLabel}>{translateUi(label)}</Text>
      </View>
      <Text style={styles.detailValue}>{value || translateUi("Not provided")}</Text>
    </View>
  );
}

export function StatusChip({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={[styles.statusChip, { backgroundColor: `${color}18` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.statusChipText, { color }]}>{translateUi(label)}</Text>
    </View>
  );
}

export function PrimaryCTA({
  disabled,
  label,
  loading,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  loading?: ReactNode;
  onPress: () => void;
}) {
  const { t: translateUi } = useLanguage();
  const arrow = useRef(new Animated.Value(0)).current;
  const translateX = arrow.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });

  return (
    <AnimatedPressable
      accessibilityLabel={translateUi(label)}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        Animated.spring(arrow, {
          damping: 16,
          stiffness: 260,
          toValue: 1,
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(arrow, {
          damping: 16,
          stiffness: 260,
          toValue: 0,
          useNativeDriver: true,
        }).start();
      }}
      style={[styles.ctaOuter, disabled && styles.disabled]}
      tint="rgba(244,197,66,0.08)"
    >
      <LinearGradient
        colors={disabled ? ['rgba(226,186,75,0.56)', 'rgba(167,126,32,0.56)'] : [COLORS.goldLight, COLORS.gold]}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.ctaGradient}
      >
        {loading || (
          <>
            <Text style={styles.ctaText}>{translateUi(label)}</Text>
            <Animated.View style={{ transform: [{ translateX }] }}>
              <Ionicons name="arrow-forward" size={18} color={COLORS.textInverse} />
            </Animated.View>
          </>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

export function ProfileFormField({
  error,
  icon,
  keyboardType,
  label,
  onChangeText,
  placeholder,
  returnKeyType,
  value,
  ...inputProps
}: TextInputProps & {
  error?: string;
  icon?: IconName;
  keyboardType?: KeyboardTypeOptions;
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  returnKeyType?: ReturnKeyTypeOptions;
  value: string;
}) {
  const { t: translateUi } = useLanguage();
  const [focused, setFocused] = useState(false);
  const focus = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(focus, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: focused ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [focus, focused]);

  const borderColor = focus.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? COLORS.error : 'rgba(255,255,255,0.08)', error ? COLORS.error : COLORS.gold],
  });

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldLabelRow}>
        {icon ? <Ionicons name={icon} size={15} color={focused ? COLORS.gold : COLORS.textMuted} /> : null}
        <Text style={[styles.fieldLabel, focused && styles.fieldLabelFocused, error && styles.fieldLabelError]}>
          {translateUi(label)}
        </Text>
      </View>
      <Animated.View style={[styles.fieldWrap, { borderColor }]}>
        <TextInput
          {...inputProps}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          returnKeyType={returnKeyType}
          style={[styles.fieldInput, inputProps.style]}
          value={value}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          onChangeText={onChangeText}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
        />
      </Animated.View>
      {error ? <Text style={styles.fieldError}>{translateUi(error)}</Text> : null}
    </View>
  );
}

export function PasswordField({
  error,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  error?: string;
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { t: translateUi } = useLanguage();
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.fieldWithIcon}>
      <ProfileFormField
        autoCapitalize="none"
        autoCorrect={false}
        error={error}
        label={translateUi(label)}
        placeholder={placeholder}
        secureTextEntry={!visible}
        style={styles.passwordInput}
        value={value}
        onChangeText={onChangeText}
      />
      <Pressable
        accessibilityLabel={visible ? `Hide ${label}` : `Show ${label}`}
        accessibilityRole="button"
        accessibilityState={{ selected: visible }}
        hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
        style={styles.eyeButton}
        onPress={() => setVisible((current) => !current)}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressTint: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
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
    height: CONTROL.minTouchSize,
    justifyContent: 'center',
    width: CONTROL.minTouchSize,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    ...typography.h2,
    color: COLORS.textPrimary,
  },
  headerSubtitle: {
    ...typography.body2,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 50,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  sectionRule: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  detailRow: {
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 58,
    paddingVertical: SPACING.md,
  },
  detailLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    ...typography.body2,
    color: COLORS.textMuted,
    flexShrink: 1,
  },
  detailValue: {
    ...typography.body2,
    color: COLORS.textPrimary,
    flex: 1.4,
    minWidth: 0,
    fontWeight: '500',
    textAlign: 'right',
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  statusDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  ctaOuter: {
    borderRadius: RADIUS.md,
  },
  ctaGradient: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  ctaText: {
    ...typography.button,
    color: COLORS.textInverse,
    flexShrink: 1,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.62,
  },
  fieldBlock: {
    gap: SPACING.xs,
  },
  fieldLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  fieldLabel: {
    ...typography.body2,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  fieldLabelFocused: {
    color: COLORS.gold,
  },
  fieldLabelError: {
    color: COLORS.error,
  },
  fieldWrap: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    minHeight: 52,
    paddingHorizontal: SPACING.md,
  },
  fieldInput: {
    ...typography.body1,
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    minHeight: 50,
    paddingVertical: 12,
  },
  fieldError: {
    color: COLORS.error,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  fieldWithIcon: {
    position: 'relative',
  },
  eyeButton: {
    alignItems: 'center',
    top: 24,
    height: 52,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 52,
  },
  passwordInput: { paddingRight: 40 },
});
