import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { sessionsService } from '@/services/api/sessions';
import { ErrorState } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { formatCurrency } from '@/utils/formatters';
import type { ProfileStackParamList } from '@/navigation/types';

// ─── Types ────────────────────────────────────────────────────────────────────
type Props = NativeStackScreenProps<ProfileStackParamList, 'ParkingHistory'>;

export interface HistorySession {
  _id: string;
  licensePlate: string;
  parkingSlot?: string;
  checkInTime: string;
  checkOutTime?: string;
  status: string;
  totalPrice?: number;
  source?: string;
  vehicleType?: string;
  entryImage_url?: string;
  exitImage_url?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  kiosk:       'Kiosk',
  app_booking: 'App',
  booking:     'Booked',
  walk_in:     'Walk-in',
};

// ─── Card ─────────────────────────────────────────────────────────────────────
const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'PARKED', color: COLORS.staffBlue },
  completed: { label: 'COMPLETED', color: COLORS.success },
  cancelled: { label: 'CANCELLED', color: COLORS.error },
};

export function StatusBadge({ status }: { status: string }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const config = SESSION_STATUS[status] || { label: status.toUpperCase(), color: COLORS.textMuted };
  useEffect(() => {
    if (status !== 'active') return undefined;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, status]);
  return <View style={[styles.statusBadge, { borderColor: `${config.color}55`, backgroundColor: `${config.color}18` }]}><Animated.View style={[styles.statusDot, { backgroundColor: config.color, opacity: status === 'active' ? pulse : 1 }]} /><Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text></View>;
}

function HistoryCard({ session, index, onPress }: { session: HistorySession; index: number; onPress: () => void }) {
  const checkIn  = new Date(session.checkInTime);
  const checkOut = session.checkOutTime ? new Date(session.checkOutTime) : null;
  const durationMins = checkOut
    ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000)
    : null;
  const h = durationMins !== null ? Math.floor(durationMins / 60) : null;
  const m = durationMins !== null ? durationMins % 60 : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Session details for ${session.licensePlate}`} style={[styles.card, index === 0 && styles.latestCard]}>
      <LinearGradient
        colors={session.status === 'completed' ? [COLORS.gold, 'transparent'] : [COLORS.textMuted, 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.cardTopLine}
      />

      <View style={styles.cardTop}>
        <View style={styles.platePill}>
          <Text style={styles.plateText}>{session.licensePlate}</Text>
        </View>
        <View style={styles.cardTopRight}>{index === 0 ? <Text style={styles.latestLabel}>LATEST</Text> : null}<StatusBadge status={session.status} />{session.totalPrice !== undefined && (
          <Text style={styles.price}>{formatCurrency(session.totalPrice)}</Text>
        )}</View>
      </View>

      <View style={styles.cardMid}>
        <View style={styles.infoItem}>
          <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.infoText}>{session.parkingSlot ?? '—'}</Text>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="log-in-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.infoText}>{format(checkIn, 'HH:mm dd/MM/yyyy')}</Text>
        </View>
      </View>

      <View style={styles.cardBot}>
        <View style={styles.infoItem}>
          <Ionicons name="log-out-outline" size={13} color={COLORS.textMuted} />
          <Text style={styles.infoText}>
            {checkOut ? format(checkOut, 'HH:mm dd/MM/yyyy') : 'Still parked'}
          </Text>
        </View>
        <View style={styles.rightRow}>
          {durationMins !== null && (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>
                {h! > 0 ? `${h}g ` : ''}{m}ph
              </Text>
            </View>
          )}
          {session.source && (
            <Text style={styles.sourceText}>{SOURCE_LABELS[session.source] ?? session.source}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function SnapshotPanel({ type, imageUrl, time, sessionStatus }: { type: 'check-in' | 'check-out'; imageUrl?: string; time?: string; sessionStatus: string }) {
  const [loading, setLoading] = useState(Boolean(imageUrl));
  const [failed, setFailed] = useState(false);
  const label = type === 'check-in' ? 'Check-in snapshot' : 'Check-out snapshot';
  return <View style={styles.snapshotPanel}><View style={styles.snapshotHeader}><Text style={styles.snapshotTitle}>{label}</Text><Text style={styles.snapshotTime}>{time || '—'}</Text></View>{imageUrl && !failed ? <View style={styles.snapshotImageWrap}>{loading ? <ActivityIndicator color={COLORS.gold} style={styles.imageLoader} /> : null}<Image source={{ uri: imageUrl }} style={styles.snapshotImage} onLoadStart={() => setLoading(true)} onLoadEnd={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} /></View> : <View style={styles.snapshotPlaceholder}><Ionicons name="camera-outline" size={30} color={COLORS.textMuted} /><Text style={styles.placeholderText}>{type === 'check-out' && sessionStatus === 'active' ? 'Vehicle has not checked out' : `No ${type === 'check-in' ? 'check-in' : 'check-out'} image`}</Text></View>}</View>;
}

export function SessionDetailModal({ session, onClose }: { session: HistorySession | null; onClose: () => void }) {
  if (!session) return null;
  const checkIn = new Date(session.checkInTime); const checkOut = session.checkOutTime ? new Date(session.checkOutTime) : null; const duration = checkOut ? Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000)) : null; const totalPrice = session.totalPrice || 0;
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaView style={styles.modalSafe}><View style={styles.modalHeader}><Pressable onPress={onClose} accessibilityRole="button" style={styles.closeButton}><Ionicons name="close" size={22} color={COLORS.textPrimary} /></Pressable><View style={styles.modalTitleWrap}><Text style={styles.modalTitle}>{session.licensePlate}</Text><Text style={styles.modalSubtitle}>{session.parkingSlot || '—'}</Text></View><StatusBadge status={session.status} /></View><ScrollView contentContainerStyle={styles.modalContent}><SnapshotPanel type="check-in" imageUrl={session.entryImage_url} time={format(checkIn, 'HH:mm dd/MM/yyyy')} sessionStatus={session.status} /><SnapshotPanel type="check-out" imageUrl={session.exitImage_url} time={checkOut ? format(checkOut, 'HH:mm dd/MM/yyyy') : undefined} sessionStatus={session.status} /><View style={styles.infoGrid}><InfoCell label="Check-in" value={format(checkIn, 'HH:mm dd/MM/yyyy')} /><InfoCell label="Check-out" value={checkOut ? format(checkOut, 'HH:mm dd/MM/yyyy') : 'Still parked'} /><InfoCell label="Duration" value={duration === null ? '—' : `${Math.floor(duration / 60)}h ${duration % 60}m`} /><InfoCell label="Source" value={SOURCE_LABELS[session.source || ''] || session.source || '—'} /><InfoCell label="Vehicle type" value={session.vehicleType || '—'} /><InfoCell label="Parking fee" value={totalPrice > 0 ? formatCurrency(totalPrice) : 'Free'} /></View></ScrollView></SafeAreaView></Modal>;
}

function InfoCell({ label, value }: { label: string; value: string }) { return <View style={styles.infoCell}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }

// ─── Screen ───────────────────────────────────────────────────────────────────
export const ParkingHistoryScreen = ({ navigation }: Props) => {
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedSession, setSelectedSession] = useState<HistorySession | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await sessionsService.getMyHistory();
      const data = (res as { data?: HistorySession[] }).data;
      setHistory(Array.isArray(data) ? data.map((session) => ({
        ...session,
        entryImage_url: session.entryImage_url,
        exitImage_url: session.exitImage_url,
      })) : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load parking history.');
      setHistory([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totalSpent = history.reduce((sum, s) => sum + (s.totalPrice ?? 0), 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Parking history</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Summary */}
      {history.length > 0 && (
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{history.length}</Text>
            <Text style={styles.summaryLabel}>Sessions</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.gold }]}>{formatCurrency(totalSpent)}</Text>
            <Text style={styles.summaryLabel}>Total spent</Text>
          </View>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={history}
          keyExtractor={item => item._id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
          }
          renderItem={({ item, index }) => <HistoryCard session={item} index={index} onPress={() => setSelectedSession(item)} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="car-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>No parking history yet</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
      <SessionDetailModal session={selectedSession} onClose={() => setSelectedSession(null)} />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  backBtn: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { fontSize: FONT_SIZES.lg, fontWeight: '700', color: COLORS.textPrimary },

  summaryRow: {
    flexDirection: 'row', marginHorizontal: SPACING.lg, marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
    padding: SPACING.md,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: FONT_SIZES.xl, fontWeight: '700', color: COLORS.textPrimary },
  summaryLabel: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xl },

  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', gap: SPACING.sm,
  },
  latestCard: { borderColor: 'rgba(212,175,55,0.5)' },
  cardTopLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTopRight: { alignItems: 'flex-end', gap: 5 },
  latestLabel: { color: COLORS.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  statusBadge: { alignItems: 'center', borderRadius: RADIUS.round, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 4 },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  platePill: {
    backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: COLORS.borderLight,
    paddingHorizontal: SPACING.sm, paddingVertical: 3,
  },
  plateText: { fontSize: FONT_SIZES.md, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: 1 },
  price: { fontSize: FONT_SIZES.md, fontWeight: '700', color: COLORS.gold },
  cardMid: { flexDirection: 'row', gap: SPACING.lg },
  cardBot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoText: { fontSize: FONT_SIZES.xs, color: COLORS.textSecondary },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  durationBadge: {
    backgroundColor: 'rgba(212,175,55,0.1)', borderRadius: RADIUS.round,
    paddingHorizontal: SPACING.sm, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.2)',
  },
  durationText: { fontSize: FONT_SIZES.xs, color: COLORS.gold, fontWeight: '600' },
  sourceText: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted },
  emptyWrap: { paddingTop: 80, alignItems: 'center', gap: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  modalSafe: { backgroundColor: COLORS.background, flex: 1 },
  modalHeader: { alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', gap: SPACING.md, padding: SPACING.lg },
  closeButton: { alignItems: 'center', backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.round, height: 40, justifyContent: 'center', width: 40 },
  modalTitleWrap: { flex: 1 }, modalTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '900', letterSpacing: 1 }, modalSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginTop: 3 },
  modalContent: { gap: SPACING.md, padding: SPACING.lg, paddingBottom: SPACING.xxl },
  snapshotPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' }, snapshotHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.md }, snapshotTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '800' }, snapshotTime: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs }, snapshotImageWrap: { backgroundColor: COLORS.surfaceElevated, minHeight: 180, position: 'relative' }, snapshotImage: { height: 210, width: '100%' }, imageLoader: { left: 0, position: 'absolute', right: 0, top: 95, zIndex: 1 }, snapshotPlaceholder: { alignItems: 'center', backgroundColor: COLORS.surfaceElevated, gap: SPACING.sm, justifyContent: 'center', minHeight: 150 }, placeholderText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  infoGrid: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: RADIUS.lg, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', padding: SPACING.sm }, infoCell: { gap: 3, padding: SPACING.sm, width: '50%' }, infoLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs }, infoValue: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
});
