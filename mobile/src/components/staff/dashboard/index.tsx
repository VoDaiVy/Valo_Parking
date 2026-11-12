import { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';

import { SkeletonBlock } from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const toneColors: Record<Tone, string> = {
  brand: COLORS.gold,
  success: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.error,
  info: COLORS.staffBlue,
  muted: COLORS.textMuted,
};

const entrance = {
  distance: 14,
  duration: 280,
};

function colorForTone(tone: Tone) {
  return toneColors[tone];
}

export function DashboardEntry({
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
      duration: entrance.duration,
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
                outputRange: [entrance.distance, 0],
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

function DashboardPressable({
  children,
  disabled,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });
  const opacity = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  const animate = (toValue: number) => {
    Animated.spring(press, {
      damping: 18,
      mass: 0.55,
      stiffness: 340,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[style, { opacity: disabled ? 0.52 : opacity, transform: [{ scale }] }]}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        disabled={disabled || !onPress}
        onPress={onPress}
        onPressIn={() => animate(1)}
        onPressOut={() => animate(0)}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function StatusPulse({ tone = 'success' }: { tone?: Tone }) {
  const progress = useRef(new Animated.Value(0)).current;
  const color = colorForTone(tone);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 900,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 900,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.42, 0] });

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseHalo, { borderColor: color, opacity, transform: [{ scale }] }]} />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

export function StaffCommandHeader({
  dateLabel,
  displayName,
  onAvatarPress,
}: {
  dateLabel: string;
  displayName: string;
  onAvatarPress?: () => void;
}) {
  const { t: translateUi } = useLanguage();
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const titleSize = useMemo(() => {
    if (width < 360) return 26;
    if (width < 410) return 28;
    return 30;
  }, [width]);
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <DashboardEntry style={styles.header}>
      <Text style={styles.eyebrow}>{t('commandCenter').toUpperCase()}</Text>
      <View style={styles.commandRow}>
        <View style={styles.headerCopy}>
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={[styles.headerTitle, { fontSize: titleSize, lineHeight: titleSize + 5 }]}
          >
            {`${t('readyForShift')}, ${displayName}`}
          </Text>
          <Text numberOfLines={1} style={styles.dateText}>{dateLabel}</Text>
        </View>
        <DashboardPressable accessibilityLabel={translateUi("Open staff profile")} onPress={onAvatarPress} style={styles.avatarPress}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </DashboardPressable>
      </View>
      <View style={styles.headerMetaRow}>
        <View style={styles.metaSpacer} />
        <View style={[styles.livePill, styles.staffPill]}>
          <StatusPulse color={COLORS.gold} />
          <Text style={[styles.liveText, styles.staffText]}>STAFF</Text>
        </View>
        <View style={styles.livePill}>
          <StatusPulse />
          <Text style={styles.liveText}>{t('liveLabel').toUpperCase()}</Text>
        </View>
      </View>
    </DashboardEntry>
  );
}

function MetricCell({
  icon,
  label,
  tone = 'brand',
  value,
}: {
  icon: IconName;
  label: string;
  tone?: Tone;
  value: string | number;
}) {
  const { t: translateUi } = useLanguage();
  const color = colorForTone(tone);
  return (
    <View style={styles.metricCell}>
      <View style={styles.metricLabelRow}>
        <Ionicons name={icon} size={15} color={color} />
        <Text numberOfLines={1} style={styles.metricLabel}>{translateUi(label)}</Text>
      </View>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

export function StaffMetricsStrip({
  active,
  capacity,
  capacityTone,
  vehicles,
}: {
  active: number;
  capacity: string;
  capacityTone: Tone;
  vehicles: number;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.metricsStrip}>
      <MetricCell icon="car-sport-outline" label={t('vehicles')} value={vehicles} />
      <View style={styles.metricDivider} />
      <MetricCell icon="pulse-outline" label={t('active')} tone="success" value={active} />
      <View style={styles.metricDivider} />
      <MetricCell icon="speedometer-outline" label={t('capacity')} tone={capacityTone} value={capacity} />
    </View>
  );
}

function PrimaryButton({
  icon,
  label,
  onPress,
  secondary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <DashboardPressable accessibilityLabel={translateUi(label)} onPress={onPress} style={secondary ? styles.secondaryActionWrap : styles.scanActionWrap}>
      <View style={secondary ? styles.secondaryAction : styles.scanAction}>
        <Ionicons name={icon} size={secondary ? 19 : 22} color={secondary ? COLORS.gold : COLORS.textInverse} />
        <Text adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={secondary ? styles.secondaryActionText : styles.scanActionText}>
          {translateUi(label)}
        </Text>
      </View>
    </DashboardPressable>
  );
}

export function StaffPrimaryActions({
  onLiveParking,
  onScanQr,
  onSessions,
}: {
  onLiveParking: () => void;
  onScanQr: () => void;
  onSessions: () => void;
}) {
  const { t } = useLanguage();
  return (
    <DashboardEntry delay={240} style={styles.actionsBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('primaryActions')}</Text>
      </View>
      <PrimaryButton icon="qr-code-outline" label={t('scanQr')} onPress={onScanQr} />
      <View style={styles.secondaryActionRow}>
        <PrimaryButton icon="map-outline" label={t('liveParking')} onPress={onLiveParking} secondary />
        <PrimaryButton icon="car-sport-outline" label={t('sessions')} onPress={onSessions} secondary />
      </View>
    </DashboardEntry>
  );
}

function UtilityStat({
  icon,
  label,
  tone,
  value,
}: {
  icon: IconName;
  label: string;
  tone: Tone;
  value: number;
}) {
  const { t: translateUi } = useLanguage();
  const color = colorForTone(tone);
  return (
    <View style={styles.utilityStat}>
      <View style={[styles.utilityIcon, { borderColor: `${color}34`, backgroundColor: `${color}12` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.headerCopy}>
        <Text style={styles.utilityLabel}>{translateUi(label)}</Text>
        <Text style={styles.utilityValue}>{value}</Text>
      </View>
    </View>
  );
}

export function StaffLiveStatus({
  available,
  capacity,
  capacityLabel,
  maintenance,
  reserved,
  tone,
}: {
  available: number;
  capacity: number;
  capacityLabel: string;
  maintenance: number;
  reserved: number;
  tone: Tone;
}) {
  const { t } = useLanguage();
  const color = colorForTone(tone);
  return (
    <DashboardEntry delay={380} style={styles.liveBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('liveStatus')}</Text>
        <Text style={styles.sectionMeta}>{capacity} {t('spaces')}</Text>
      </View>
      <View style={[styles.capacityStrip, { borderLeftColor: color }]}>
        <StatusPulse tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'} />
        <View style={styles.headerCopy}>
          <Text style={[styles.capacityLabel, { color }]}>{capacityLabel}</Text>
          <Text numberOfLines={1} style={styles.capacityValue}>{available} {t('availableSpaces')}</Text>
        </View>
      </View>
      <View style={styles.utilityRow}>
        <UtilityStat icon="bookmark-outline" label={t('reserved')} tone="warning" value={reserved} />
        <UtilityStat icon="construct-outline" label={t('maintenance')} tone={maintenance > 0 ? 'danger' : 'muted'} value={maintenance} />
      </View>
    </DashboardEntry>
  );
}

export function StaffAlertRow({ count, onPress }: { count: number; onPress: () => void }) {
  const { t: translateUi } = useLanguage();
  const { t } = useLanguage();
  return (
    <DashboardEntry delay={520}>
      <DashboardPressable accessibilityLabel={translateUi("Review blocked bookings")} onPress={onPress}>
        <View style={styles.alertRow}>
          <View style={styles.alertIcon}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.error} />
          </View>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.alertTitle}>{count} {t('blockedBookings')}</Text>
            <Text numberOfLines={1} style={styles.alertMeta}>{t('reviewRequired')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.error} />
        </View>
      </DashboardPressable>
    </DashboardEntry>
  );
}

export function StaffDashboardSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <SkeletonBlock height={22} width="34%" />
      <View style={styles.metricsStrip}>
        <View style={styles.skeletonMetric}><SkeletonBlock height={15} width="72%" /><SkeletonBlock height={30} width="48%" /></View>
        <View style={styles.metricDivider} />
        <View style={styles.skeletonMetric}><SkeletonBlock height={15} width="72%" /><SkeletonBlock height={30} width="48%" /></View>
        <View style={styles.metricDivider} />
        <View style={styles.skeletonMetric}><SkeletonBlock height={15} width="72%" /><SkeletonBlock height={30} width="48%" /></View>
      </View>
      <SkeletonBlock height={66} />
      <View style={styles.secondaryActionRow}>
        <SkeletonBlock height={58} style={styles.skeletonHalf} />
        <SkeletonBlock height={58} style={styles.skeletonHalf} />
      </View>
      <SkeletonBlock height={72} />
      <SkeletonBlock height={58} />
    </View>
  );
}

export function StaffRecentActivityRow({
  meta,
  onPress,
  subtitle,
  title,
  tone = 'brand',
}: {
  meta?: string;
  onPress: () => void;
  subtitle: string;
  title: string;
  tone?: Tone;
}) {
  const color = colorForTone(tone);
  return (
    <DashboardPressable accessibilityLabel={`Open booking ${title}`} onPress={onPress}>
      <View style={styles.recentRow}>
        <View style={[styles.recentMarker, { backgroundColor: color }]} />
        <View style={styles.headerCopy}>
          <View style={styles.recentTop}>
            <Text numberOfLines={1} style={styles.recentTitle}>{title}</Text>
            {meta ? <Text numberOfLines={1} style={styles.recentMeta}>{meta}</Text> : null}
          </View>
          <Text numberOfLines={1} style={styles.recentSubtitle}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
      </View>
    </DashboardPressable>
  );
}

export function EmptyRecentActivity() {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.emptyRecent}>
      <Ionicons name="calendar-outline" size={20} color={COLORS.textMuted} />
      <View style={styles.headerCopy}>
        <Text style={styles.emptyTitle}>{translateUi("No booking activity yet")}</Text>
        <Text style={styles.emptySubtitle}>{translateUi("New reservations and operational changes will appear here.")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsBlock: { gap: SPACING.md },
  alertIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,77,77,0.12)',
    borderRadius: RADIUS.round,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  alertMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800', marginTop: 2, textTransform: 'uppercase' },
  alertRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderColor: 'rgba(255,77,77,0.34)',
    borderLeftColor: COLORS.error,
    borderLeftWidth: 3,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 64,
    paddingHorizontal: SPACING.md,
  },
  alertTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '700' },
  capacityLabel: { fontSize: FONT_SIZES.xs, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase' },
  capacityStrip: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderLeftWidth: 3,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 68,
    paddingHorizontal: SPACING.md,
  },
  capacityValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: 2 },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderColor: 'rgba(244,244,240,0.18)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarPress: { borderRadius: RADIUS.round, flexShrink: 0 },
  avatarText: { color: COLORS.textInverse, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  commandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
  },
  dateText: { color: COLORS.textMuted, fontSize: 16, lineHeight: 21, marginTop: 2 },
  emptyRecent: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 62,
    paddingVertical: SPACING.sm,
  },
  emptySubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, lineHeight: 17, marginTop: 2 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  eyebrow: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  header: {
    gap: 6,
    paddingBottom: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: 0,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  headerTop: { alignItems: 'center', flexDirection: 'row' },
  liveBlock: { gap: SPACING.md },
  livePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderColor: 'rgba(76,175,80,0.32)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 42,
    paddingHorizontal: SPACING.md,
  },
  liveText: { color: COLORS.success, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  staffPill: { backgroundColor: COLORS.goldTint, borderColor: `${COLORS.gold}55` },
  staffText: { color: COLORS.gold },
  metaSpacer: { flex: 1 },
  metricCell: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 82,
    minWidth: 0,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  metricDivider: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
    width: StyleSheet.hairlineWidth,
  },
  metricLabel: {
    color: COLORS.textMuted,
    flex: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  metricsStrip: {
    borderBottomColor: COLORS.border,
    borderTopColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  metricValue: { fontSize: 25, fontWeight: '700', letterSpacing: 0, marginTop: 7 },
  pulseDot: { borderRadius: 4, height: 8, width: 8 },
  pulseHalo: {
    borderRadius: 10,
    borderWidth: 1,
    height: 18,
    position: 'absolute',
    width: 18,
  },
  pulseWrap: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  recentMarker: { borderRadius: RADIUS.round, height: 8, width: 8 },
  recentMeta: { color: COLORS.textMuted, flexShrink: 0, fontSize: FONT_SIZES.xs, fontWeight: '800', marginLeft: SPACING.sm },
  recentRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 58,
    paddingVertical: SPACING.sm,
  },
  recentSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  recentTitle: { color: COLORS.textPrimary, flex: 1, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  recentTop: { alignItems: 'center', flexDirection: 'row' },
  scanAction: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 66,
    paddingHorizontal: SPACING.md,
  },
  scanActionText: { color: COLORS.textInverse, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  scanActionWrap: { borderRadius: RADIUS.md },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(226,186,75,0.32)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: SPACING.sm,
  },
  secondaryActionRow: { flexDirection: 'row', gap: SPACING.sm },
  secondaryActionText: { color: COLORS.gold, flexShrink: 1, fontSize: FONT_SIZES.md, fontWeight: '700' },
  secondaryActionWrap: { borderRadius: RADIUS.md, flex: 1, minWidth: 0 },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 26,
  },
  sectionMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  sectionTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  skeletonHalf: { flex: 1 },
  skeletonMetric: { flex: 1, gap: SPACING.sm, minHeight: 82, padding: SPACING.md },
  skeletonWrap: { gap: SPACING.md },
  utilityIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  utilityLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800', textTransform: 'uppercase' },
  utilityRow: { flexDirection: 'row', gap: SPACING.sm },
  utilityStat: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 58,
    minWidth: 0,
    paddingVertical: SPACING.sm,
  },
  utilityValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: 1 },
});
