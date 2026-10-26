import { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const toneColor: Record<Tone, string> = {
  brand: COLORS.gold,
  success: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.error,
  info: COLORS.staffBlue,
  muted: COLORS.textMuted,
};

export const STAFF_MOTION = {
  fast: 180,
  normal: 260,
  slow: 350,
  pressScale: 0.975,
  rowPressScale: 0.98,
  entranceDistance: 12,
  stagger: 50,
};

export function staffToneColor(tone: Tone) {
  return toneColor[tone];
}

export function AnimatedPressable({
  children,
  disabled,
  onPress,
  style,
  row,
  ...props
}: PressableProps & {
  children: React.ReactNode;
  row?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, row ? STAFF_MOTION.rowPressScale : STAFF_MOTION.pressScale],
  });

  const animate = (toValue: number) => {
    Animated.spring(press, {
      damping: 18,
      mass: 0.55,
      stiffness: 320,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[style, { opacity: disabled ? 0.52 : 1, transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animate(1)}
        onPressOut={() => animate(0)}
        {...props}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function FadeInView({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      delay,
      duration: STAFF_MOTION.normal,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [STAFF_MOTION.entranceDistance, 0],
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

export function StaffHeader({
  title,
  subtitle,
  eyebrow,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <AnimatedPressable accessibilityLabel="Go back" onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textSecondary} />
        </AnimatedPressable>
      ) : null}
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text ellipsizeMode="tail" numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function SectionTitle({
  title,
  detail,
  right,
}: {
  title: string;
  detail?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.headerCopy}>
        <Text style={styles.sectionText}>{title}</Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function StatusBadge({
  label,
  tone = 'brand',
}: {
  label: string;
  tone?: Tone;
}) {
  const color = toneColor[tone];
  return (
    <View style={[styles.badge, { borderColor: `${color}44`, backgroundColor: `${color}14` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function StatusStrip({
  label,
  value,
  tone = 'brand',
  icon,
}: {
  label: string;
  value: string;
  tone?: Tone;
  icon?: IconName;
}) {
  const color = toneColor[tone];
  return (
    <View style={[styles.statusStrip, { borderLeftColor: color }]}>
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <View style={styles.headerCopy}>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.statusValue}>{value}</Text>
      </View>
    </View>
  );
}

export function OperationalMetric({
  label,
  value,
  tone = 'brand',
  icon,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  icon?: IconName;
}) {
  const color = toneColor[tone];
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        {icon ? <Ionicons name={icon} size={16} color={color} /> : <View style={[styles.metricDot, { backgroundColor: color }]} />}
        <Text numberOfLines={1} style={styles.metricLabel}>{label}</Text>
      </View>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

export function MetricStrip({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.metricStrip, style]}>{children}</View>;
}

export function ActionButton({
  label,
  icon,
  onPress,
  tone = 'brand',
  secondary,
  disabled,
  loading,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  tone?: Tone;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const color = toneColor[tone];
  return (
    <AnimatedPressable disabled={disabled || loading} onPress={onPress} style={styles.buttonWrap}>
      <View
        style={[
          styles.button,
          secondary
            ? { backgroundColor: COLORS.surface, borderColor: `${color}44`, borderWidth: 1 }
            : { backgroundColor: color },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={secondary ? color : COLORS.textInverse} size="small" />
        ) : icon ? (
          <Ionicons name={icon} size={19} color={secondary ? color : COLORS.textInverse} />
        ) : null}
        <Text style={[styles.buttonText, secondary && { color }]}>{label}</Text>
      </View>
    </AnimatedPressable>
  );
}

export const PrimaryCTA = ActionButton;
export const SecondaryCTA = (props: Omit<React.ComponentProps<typeof ActionButton>, 'secondary'>) => (
  <ActionButton {...props} secondary />
);

export function OperationalRow({
  title,
  subtitle,
  meta,
  icon,
  iconElement,
  tone = 'brand',
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: IconName;
  iconElement?: React.ReactNode;
  tone?: Tone;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const color = toneColor[tone];
  const body = (
    <View style={styles.row}>
      {icon || iconElement ? (
        <View style={[styles.rowIcon, { backgroundColor: `${color}14` }]}>
          {iconElement ?? <Ionicons name={icon} size={20} color={color} />}
        </View>
      ) : null}
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
          {meta ? <Text numberOfLines={1} style={styles.rowMeta}>{meta}</Text> : null}
        </View>
        {subtitle ? <Text numberOfLines={2} style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} /> : null)}
    </View>
  );

  return onPress ? (
    <AnimatedPressable row onPress={onPress}>
      {body}
    </AnimatedPressable>
  ) : body;
}

export const VehicleRow = OperationalRow;
export const SessionRow = OperationalRow;
export const BookingRow = OperationalRow;

export function Timeline({
  items,
}: {
  items: Array<{ label: string; value: string; tone?: Tone; icon?: IconName }>;
}) {
  return (
    <View style={styles.timeline}>
      {items.map((item, index) => {
        const color = toneColor[item.tone ?? 'brand'];
        return (
          <View key={`${item.label}-${index}`} style={styles.timelineItem}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: color }]} />
              {index < items.length - 1 ? <View style={styles.timelineLine} /> : null}
            </View>
            <View style={styles.timelineCopy}>
              <Text style={styles.timelineLabel}>{item.label}</Text>
              <Text style={styles.timelineValue}>{item.value}</Text>
            </View>
            {item.icon ? <Ionicons name={item.icon} size={18} color={color} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function BottomActionBar({ children }: { children: React.ReactNode }) {
  return <View style={styles.bottomActionBar}>{children}</View>;
}

export const StickyFooter = BottomActionBar;

export function InfoBanner({
  title,
  message,
  tone = 'info',
  icon,
}: {
  title: string;
  message?: string;
  tone?: Tone;
  icon?: IconName;
}) {
  const color = toneColor[tone];
  return (
    <View style={[styles.infoBanner, { borderColor: `${color}44` }]}>
      <Ionicons name={icon ?? 'information-circle-outline'} size={22} color={color} />
      <View style={styles.headerCopy}>
        <Text style={styles.infoTitle}>{title}</Text>
        {message ? <Text style={styles.infoMessage}>{message}</Text> : null}
      </View>
    </View>
  );
}

export function SkeletonBlock({ height = 18, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const shimmer = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { duration: 650, toValue: 0.82, useNativeDriver: true }),
        Animated.timing(shimmer, { duration: 650, toValue: 0.35, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [shimmer]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { height, opacity: shimmer, width },
        style,
      ]}
    />
  );
}

export function ConfirmationPanel({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'brand',
  loading,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <Pressable accessibilityLabel="Close confirmation" onPress={onCancel} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.panelSafe}>
          <View style={styles.panel}>
            <View style={styles.panelHandle} />
            <Text style={styles.panelTitle}>{title}</Text>
            {message ? <Text style={styles.panelMessage}>{message}</Text> : null}
            <View style={styles.panelActions}>
              <ActionButton label={cancelLabel} onPress={onCancel} secondary tone="muted" />
              <ActionButton label={confirmLabel} loading={loading} onPress={onConfirm} tone={tone} />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  backButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerRight: { alignItems: 'flex-end', flexShrink: 0 },
  eyebrow: {
    color: COLORS.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '900', letterSpacing: 0, lineHeight: 32 },
  subtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, lineHeight: 16, marginTop: 1 },
  sectionTitle: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'space-between',
    minHeight: 36,
  },
  sectionText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  sectionDetail: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: SPACING.sm,
  },
  badgeDot: { borderRadius: 3, height: 6, width: 6 },
  badgeText: { fontSize: FONT_SIZES.xs, fontWeight: '900', textTransform: 'uppercase' },
  statusStrip: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderLeftWidth: 3,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 58,
    paddingHorizontal: SPACING.md,
  },
  statusLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800', textTransform: 'uppercase' },
  statusValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900', marginTop: 2 },
  metricStrip: {
    borderBottomColor: COLORS.border,
    borderTopColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  metric: {
    flex: 1,
    minHeight: 84,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  metricTop: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  metricDot: { borderRadius: 4, height: 8, width: 8 },
  metricLabel: { color: COLORS.textMuted, flex: 1, fontSize: FONT_SIZES.xs, fontWeight: '800', textTransform: 'uppercase' },
  metricValue: { fontSize: 25, fontWeight: '900', letterSpacing: 0, marginTop: 7 },
  buttonWrap: { borderRadius: RADIUS.md, flex: 1, minWidth: 0 },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: SPACING.md,
  },
  buttonText: { color: COLORS.textInverse, flexShrink: 1, fontSize: FONT_SIZES.md, fontWeight: '900' },
  row: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 68,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  rowIcon: { alignItems: 'center', borderRadius: RADIUS.md, height: 44, justifyContent: 'center', width: 44 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: SPACING.sm },
  rowTitle: { color: COLORS.textPrimary, flex: 1, fontSize: FONT_SIZES.md, fontWeight: '800' },
  rowMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  rowSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, lineHeight: 17, marginTop: 3 },
  timeline: { gap: 0 },
  timelineItem: { flexDirection: 'row', gap: SPACING.sm, minHeight: 58 },
  timelineRail: { alignItems: 'center', width: 18 },
  timelineDot: { borderRadius: 5, height: 10, marginTop: 4, width: 10 },
  timelineLine: { backgroundColor: COLORS.border, flex: 1, marginTop: 4, width: StyleSheet.hairlineWidth },
  timelineCopy: { flex: 1, minWidth: 0 },
  timelineLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800', textTransform: 'uppercase' },
  timelineValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '800', marginTop: 2 },
  bottomActionBar: {
    backgroundColor: 'rgba(11,12,14,0.96)',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.lg,
  },
  infoBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 64,
    padding: SPACING.md,
  },
  infoTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900' },
  infoMessage: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, lineHeight: 18, marginTop: 2 },
  skeleton: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  panelSafe: { justifyContent: 'flex-end' },
  panel: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  panelHandle: {
    alignSelf: 'center',
    backgroundColor: COLORS.borderLight,
    borderRadius: RADIUS.round,
    height: 4,
    marginBottom: SPACING.xs,
    width: 42,
  },
  panelTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '900' },
  panelMessage: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, lineHeight: 20 },
  panelActions: { flexDirection: 'row', gap: SPACING.sm },
});
