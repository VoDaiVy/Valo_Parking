import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeInView, StaffHeader, StatusBadge } from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { formatCurrency } from '@/utils/formatters';
import type { StaffSessionStackParamList } from './SessionListScreen';
import { SessionActionsPanel } from '@/components/staff/SessionActionsPanel';

type Props = NativeStackScreenProps<StaffSessionStackParamList, 'SessionDetail'>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const SOURCE_LABELS: Record<string, string> = {
  kiosk: 'Self-service kiosk',
  app_booking: 'App booking',
  booking: 'Booked',
  staff_manual: 'Staff manual',
  walk_in: 'Walk-in',
};

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  car: 'Car',
  electric_car: 'Electric car',
  motorcycle: 'Motorcycle',
};

function durationLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function DetailLine({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: IconName;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.detailLine}>
      <View style={styles.lineIcon}>
        <Ionicons name={icon} size={16} color={COLORS.textMuted} />
      </View>
      <View style={styles.lineCopy}>
        <Text style={styles.lineLabel}>{label}</Text>
        <Text numberOfLines={1} style={[styles.lineValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      </View>
    </View>
  );
}

function EvidenceRow({
  imageUrl,
  label,
  meta,
  onPreview,
  tone,
}: {
  imageUrl?: string;
  label: string;
  meta: string;
  onPreview: (url: string) => void;
  tone: string;
}) {
  const [loading, setLoading] = useState(Boolean(imageUrl));
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(imageUrl && !failed);

  return (
    <View style={styles.evidenceRow}>
      <View style={[styles.evidenceIcon, { backgroundColor: `${tone}14` }]}>
        <Ionicons name="camera-outline" size={18} color={tone} />
      </View>
      <View style={styles.evidenceCopy}>
        <Text style={styles.evidenceTitle}>{label}</Text>
        <Text numberOfLines={1} style={styles.evidenceMeta}>{meta}</Text>
      </View>
      {hasImage ? (
        <TouchableOpacity
          accessibilityLabel={`Open ${label.toLowerCase()} image`}
          accessibilityRole="imagebutton"
          activeOpacity={0.86}
          onPress={() => imageUrl && onPreview(imageUrl)}
          style={styles.thumb}
        >
          <Image
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onLoadStart={() => setLoading(true)}
            source={{ uri: imageUrl as string }}
            style={styles.thumbImage}
          />
          {loading ? <ActivityIndicator color={tone} size="small" style={StyleSheet.absoluteFill} /> : null}
        </TouchableOpacity>
      ) : (
        <View style={styles.emptyThumb}>
          <Ionicons name={failed ? 'cloud-offline-outline' : 'camera-outline'} size={20} color={COLORS.textMuted} />
          <Text numberOfLines={1} style={styles.emptyThumbText}>
            {failed ? 'Image failed' : `No ${label.toLowerCase()} image`}
          </Text>
        </View>
      )}
    </View>
  );
}

export const SessionDetailScreen = ({ navigation, route }: Props) => {
  const [session, setSession] = useState(route.params.session);
  const tabBarHeight = useBottomTabBarHeight();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const checkIn = new Date(session.checkInTime);
  const checkOut = session.checkOutTime ? new Date(session.checkOutTime) : null;
  const elapsedMins = checkOut
    ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000)
    : Math.floor((Date.now() - checkIn.getTime()) / 60000);
  const isActive = session.status === 'active';
  const statusTone = isActive ? COLORS.success : COLORS.textMuted;
  const paymentStatus = session.paymentStatus ?? 'unpaid';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Sessions"
        title="Session details"
        onBack={() => navigation.goBack()}
        right={<StatusBadge label={isActive ? 'Active' : 'Done'} tone={isActive ? 'success' : 'muted'} />}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + SPACING.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <FadeInView>
          <View style={styles.summary}>
            <View style={styles.summaryTop}>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.plate}>{session.licensePlate}</Text>
              <View style={[styles.inlineStatus, { borderColor: `${statusTone}44`, backgroundColor: `${statusTone}14` }]}>
                <View style={[styles.statusDot, { backgroundColor: statusTone }]} />
                <Text style={[styles.inlineStatusText, { color: statusTone }]}>{isActive ? 'Active' : 'Done'}</Text>
              </View>
            </View>
            <View style={styles.spaceRow}>
              <Ionicons name="location" size={15} color={COLORS.gold} />
              <Text numberOfLines={1} style={styles.spaceText}>{session.parkingSlot ?? 'Space not assigned'}</Text>
            </View>
            <View style={styles.timelineRow}>
              <View style={styles.timeCell}>
                <Text style={styles.timeLabel}>Check-in</Text>
                <Text style={styles.timeValue}>{format(checkIn, 'HH:mm')}</Text>
                <Text style={styles.timeMeta}>{format(checkIn, 'dd/MM')}</Text>
              </View>
              <View style={styles.durationCell}>
                <Text style={styles.duration}>{durationLabel(elapsedMins)}</Text>
                <View style={styles.durationLine} />
              </View>
              <View style={[styles.timeCell, styles.timeCellRight]}>
                <Text style={styles.timeLabel}>Check-out</Text>
                <Text style={[styles.timeValue, !checkOut && styles.mutedValue]}>{checkOut ? format(checkOut, 'HH:mm') : '--:--'}</Text>
                <Text style={styles.timeMeta}>{checkOut ? format(checkOut, 'dd/MM') : 'Pending'}</Text>
              </View>
            </View>
          </View>
        </FadeInView>

        <FadeInView delay={60} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Security records</Text>
            <View style={styles.evidenceBadge}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.staffBlue} />
              <Text style={styles.evidenceBadgeText}>
                {[session.entryImage_url, session.exitImage_url].filter(Boolean).length}/2 images
              </Text>
            </View>
          </View>
          <View style={styles.rowsPanel}>
            <EvidenceRow
              imageUrl={session.entryImage_url}
              label="Entry"
              meta={session.checkInTime ? format(checkIn, 'HH:mm:ss dd/MM/yyyy') : 'Not recorded'}
              onPreview={setPreviewImage}
              tone={COLORS.staffBlue}
            />
            <View style={styles.divider} />
            <EvidenceRow
              imageUrl={session.exitImage_url}
              label="Exit"
              meta={checkOut ? format(checkOut, 'HH:mm:ss dd/MM/yyyy') : 'Not recorded'}
              onPreview={setPreviewImage}
              tone={COLORS.success}
            />
          </View>
        </FadeInView>

        <FadeInView delay={110} style={styles.section}>
          <Text style={styles.sectionTitle}>Operations</Text>
          <View style={styles.rowsPanel}>
            <DetailLine
              icon="car-outline"
              label="Vehicle type"
              value={VEHICLE_TYPE_LABELS[session.vehicleType ?? ''] ?? session.vehicleType ?? 'Unknown'}
            />
            <View style={styles.divider} />
            <DetailLine
              icon="git-branch-outline"
              label="Entry source"
              value={SOURCE_LABELS[session.source ?? ''] ?? session.source ?? 'Unknown'}
            />
            {session.phone ? (
              <>
                <View style={styles.divider} />
                <DetailLine icon="call-outline" label="Phone" value={session.phone} />
              </>
            ) : null}
          </View>
        </FadeInView>

        {session.totalPrice !== undefined ? (
          <FadeInView delay={160} style={styles.section}>
            <Text style={styles.sectionTitle}>Payment</Text>
            <View style={styles.rowsPanel}>
              <DetailLine
                icon="wallet-outline"
                label="Status"
                value={paymentStatus}
                valueColor={paymentStatus === 'paid' ? COLORS.success : undefined}
              />
              <View style={styles.divider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatCurrency(session.totalPrice ?? 0)}</Text>
              </View>
            </View>
          </FadeInView>
        ) : null}

        <SessionActionsPanel session={session} onUpdated={setSession} />
        <Text style={styles.idRef}>ID: {session._id}</Text>
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
        statusBarTranslucent
        transparent
        visible={Boolean(previewImage)}
      >
        <View style={styles.previewModal}>
          <Pressable
            accessibilityLabel="Close image preview"
            accessibilityRole="button"
            onPress={() => setPreviewImage(null)}
            style={StyleSheet.absoluteFill}
          />
          <TouchableOpacity
            accessibilityLabel="Close image preview"
            accessibilityRole="button"
            onPress={() => setPreviewImage(null)}
            style={styles.previewClose}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImage ? (
            <Image
              accessibilityLabel="Security image preview"
              resizeMode="contain"
              source={{ uri: previewImage }}
              style={styles.previewImage}
            />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scroll: { gap: SPACING.md, padding: SPACING.md },
  summary: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(96,180,255,0.22)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  summaryTop: { alignItems: 'center', flexDirection: 'row', gap: SPACING.sm },
  plate: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.xl,
    fontWeight: '900',
    letterSpacing: 2,
  },
  inlineStatus: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: SPACING.sm,
  },
  statusDot: { borderRadius: 3, height: 6, width: 6 },
  inlineStatusText: { fontSize: FONT_SIZES.xs, fontWeight: '900' },
  spaceRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  spaceText: { color: COLORS.gold, flex: 1, fontSize: FONT_SIZES.md, fontWeight: '800' },
  timelineRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    padding: SPACING.sm,
  },
  timeCell: { flex: 1 },
  timeCellRight: { alignItems: 'flex-end' },
  timeLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  timeValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  timeMeta: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  mutedValue: { color: COLORS.textMuted },
  durationCell: { alignItems: 'center', flex: 0.7, paddingHorizontal: SPACING.sm },
  duration: { color: COLORS.gold, fontSize: FONT_SIZES.xs, fontWeight: '900' },
  durationLine: { backgroundColor: COLORS.borderLight, height: 1, marginTop: 5, width: 44 },
  section: { gap: SPACING.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  evidenceBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(96,180,255,0.1)',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: SPACING.sm,
  },
  evidenceBadgeText: { color: COLORS.staffBlue, fontSize: 10, fontWeight: '800' },
  rowsPanel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  evidenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 94,
    padding: SPACING.sm,
  },
  evidenceIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  evidenceCopy: { flex: 1, minWidth: 0 },
  evidenceTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900' },
  evidenceMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  thumb: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 74,
    overflow: 'hidden',
    width: 96,
  },
  thumbImage: { height: '100%', width: '100%' },
  emptyThumb: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 4,
    height: 74,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
    width: 96,
  },
  emptyThumbText: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  detailLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 56,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  lineIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  lineCopy: { flex: 1, minWidth: 0 },
  lineLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  lineValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '800', marginTop: 2 },
  divider: { backgroundColor: COLORS.border, height: StyleSheet.hairlineWidth, marginHorizontal: SPACING.md },
  totalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: SPACING.md,
  },
  totalLabel: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900' },
  totalValue: { color: COLORS.gold, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  idRef: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, textAlign: 'center' },
  previewModal: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.94)',
    flex: 1,
    justifyContent: 'center',
  },
  previewClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.round,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: SPACING.lg,
    top: 52,
    width: 48,
    zIndex: 2,
  },
  previewImage: { height: '82%', width: '100%' },
});
