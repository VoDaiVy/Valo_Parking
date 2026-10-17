import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSocket } from '@/hooks/useSocket';
import { useToast } from '@/hooks/useToast';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import {
  staffGateService,
  type GateName,
  type GateState,
} from '@/services/api/staffGates';

const GATE_OPTIONS: { gate: GateName; label: string; shortLabel: string }[] = [
  { gate: 'ENTRY_1', label: 'Entry gate', shortLabel: 'ENTRY (IN)' },
  { gate: 'EXIT_1', label: 'Exit gate', shortLabel: 'EXIT (OUT)' },
];

type GateAction = 'open' | 'close' | 'hold' | 'resume';

const initialGates: Record<GateName, GateState> = {
  ENTRY_1: {
    gate: 'ENTRY_1', open: false, holdOpen: false, forceClose: false,
    triggerId: 0, licensePlate: '', slotCode: '', timestamp: 0,
  },
  EXIT_1: {
    gate: 'EXIT_1', open: false, holdOpen: false, forceClose: false,
    triggerId: 0, licensePlate: '', slotCode: '', timestamp: 0,
  },
};

const isGateState = (value: unknown): value is GateState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GateState>;
  return (state.gate === 'ENTRY_1' || state.gate === 'EXIT_1')
    && typeof state.open === 'boolean'
    && typeof state.holdOpen === 'boolean';
};

const gateStatesEqual = (left: GateState, right: GateState) =>
  left.gate === right.gate
  && left.open === right.open
  && left.holdOpen === right.holdOpen
  && left.forceClose === right.forceClose
  && left.triggerId === right.triggerId
  && left.licensePlate === right.licensePlate
  && left.slotCode === right.slotCode
  && left.timestamp === right.timestamp;

const statusText = (gate: GateState, available: boolean) => {
  if (!available) return 'Status unavailable';
  if (gate.holdOpen) return 'Paused · sensor disabled';
  if (gate.open) return 'Open command sent';
  if (gate.forceClose) return 'Close command sent';
  return 'Closed';
};

export function GateControlPanel() {
  const focused = useIsFocused();
  const socket = useSocket();
  const { showError, showSuccess } = useToast();
  const [gates, setGates] = useState(initialGates);
  const [selectedGate, setSelectedGate] = useState<GateName>('ENTRY_1');
  const [visible, setVisible] = useState(false);
  const [statusAvailable, setStatusAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<GateAction | null>(null);
  const requestInFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await staffGateService.getStatus();
      if (response.success && response.gates) {
        setGates((current) => {
          const next = { ...current, ...response.gates };
          return gateStatesEqual(current.ENTRY_1, next.ENTRY_1)
            && gateStatesEqual(current.EXIT_1, next.EXIT_1) ? current : next;
        });
        setStatusAvailable((current) => current ? current : true);
      } else {
        setStatusAvailable((current) => current ? false : current);
      }
    } catch {
      setStatusAvailable((current) => current ? false : current);
    } finally {
      setLoading(false);
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!focused) return undefined;

    void refreshStatus();
    const handleGateUpdate = (payload: unknown) => {
      if (!isGateState(payload)) return;
      setGates((current) => gateStatesEqual(current[payload.gate], payload)
        ? current
        : { ...current, [payload.gate]: payload });
      setStatusAvailable(true);
    };

    socket.on('gate:barrier_control', handleGateUpdate);
    return () => {
      socket.off('gate:barrier_control', handleGateUpdate);
    };
  }, [focused, refreshStatus, socket]);

  useEffect(() => {
    if (!focused || !visible) return undefined;
    const interval = setInterval(() => void refreshStatus(), 10000);
    return () => clearInterval(interval);
  }, [focused, refreshStatus, visible]);

  const gateState = gates[selectedGate];
  const selectedLabel = GATE_OPTIONS.find((option) => option.gate === selectedGate)?.label ?? 'Gate';

  const performAction = useCallback(async (action: GateAction) => {
    setBusyAction(action);
    try {
      const response = action === 'open'
        ? await staffGateService.open(selectedGate)
        : action === 'close'
          ? await staffGateService.close(selectedGate)
          : await staffGateService.setHold(selectedGate, action === 'hold');

      if (!response.success) throw new Error(response.message || 'The gate command was rejected.');
      setGates((current) => gateStatesEqual(current[selectedGate], response.data)
        ? current
        : { ...current, [selectedGate]: response.data });
      setStatusAvailable(true);
      const message = response.message || 'Command sent to the gate controller.';
      showSuccess('Gate command sent', message);
      void refreshStatus();
    } catch (error) {
      showError('Gate command failed', error instanceof Error ? error.message : 'Unable to reach the gate controller.');
    } finally {
      setBusyAction(null);
    }
  }, [refreshStatus, selectedGate, showError, showSuccess]);

  const openControls = () => {
    setVisible(true);
    void refreshStatus();
  };

  const compactStatus = (gate: GateState) => {
    if (!statusAvailable) return 'Unavailable';
    if (gate.holdOpen) return 'Paused';
    if (gate.open) return 'Open command sent';
    if (gate.forceClose) return 'Closing';
    return 'Closed';
  };
  const summary = loading
    ? 'Loading gate status…'
    : `IN ${compactStatus(gates.ENTRY_1)} · OUT ${compactStatus(gates.EXIT_1)}`;

  return (
    <>
      <Pressable accessibilityRole="button" onPress={openControls} style={styles.summaryCard}>
        <View style={styles.summaryIcon}>
          <Ionicons name="radio-outline" size={21} color={COLORS.success} />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>Gate & Actions</Text>
          <Text numberOfLines={1} style={styles.summarySubtitle}>{summary}</Text>
        </View>
        <View style={styles.summaryAction}>
          <Text style={styles.summaryActionText}>CONTROL</Text>
          <Ionicons name="chevron-forward" size={15} color={COLORS.gold} />
        </View>
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        statusBarTranslucent
        transparent
        visible={visible}
      >
        <View style={styles.modalBackdrop}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.headerTitleWrap}>
                <Ionicons name="radio-outline" size={22} color={COLORS.success} />
                <Text style={styles.sheetTitle}>Gate & Actions</Text>
              </View>
              <Pressable accessibilityLabel="Close gate controls" onPress={() => setVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <View style={styles.gateSelector}>
                {GATE_OPTIONS.map((option) => {
                  const active = selectedGate === option.gate;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={option.gate}
                      onPress={() => setSelectedGate(option.gate)}
                      style={[styles.gateTab, active && styles.gateTabActive]}
                    >
                      <Ionicons
                        color={active ? COLORS.textInverse : COLORS.textMuted}
                        name={option.gate === 'ENTRY_1' ? 'log-in-outline' : 'log-out-outline'}
                        size={17}
                      />
                      <Text style={[styles.gateTabText, active && styles.gateTabTextActive]}>{option.shortLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={[styles.statusCard, gateState.open && styles.statusCardOpen, gateState.holdOpen && styles.statusCardPaused]}>
                <View style={styles.statusIcon}>
                  <Ionicons
                    color={gateState.holdOpen ? COLORS.warning : gateState.open ? COLORS.success : COLORS.textMuted}
                    name={gateState.open ? 'lock-open-outline' : 'lock-closed-outline'}
                    size={25}
                  />
                </View>
                <View style={styles.statusCopy}>
                  <Text style={styles.statusTitle}>{selectedLabel.toUpperCase()} ({selectedGate})</Text>
                  <Text style={styles.statusDescription}>{statusText(gateState, statusAvailable)}</Text>
                </View>
                {loading ? (
                  <ActivityIndicator color={COLORS.gold} />
                ) : (
                  <View style={[styles.statusDot, gateState.open && styles.statusDotOpen]} />
                )}
              </View>

              {!statusAvailable ? (
                <Text style={styles.connectionNote}>Can’t read gate status. You can still try a command; the app will report if the server can’t be reached.</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyAction)}
                onPress={() => void performAction(gateState.open ? 'close' : 'open')}
                style={[styles.primaryButton, gateState.open ? styles.closeGateButton : styles.openGateButton, busyAction && styles.disabledButton]}
              >
                {busyAction === 'open' || busyAction === 'close' ? <ActivityIndicator color="#FFFFFF" /> : (
                  <>
                    <Ionicons color="#FFFFFF" name={gateState.open ? 'lock-closed-outline' : 'lock-open-outline'} size={19} />
                    <Text style={styles.primaryButtonText}>{gateState.open ? 'CLOSE GATE' : `OPEN ${selectedGate === 'ENTRY_1' ? 'ENTRY' : 'EXIT'} GATE`}</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyAction)}
                onPress={() => void performAction(gateState.holdOpen ? 'resume' : 'hold')}
                style={[styles.secondaryButton, busyAction && styles.disabledButton]}
              >
                {busyAction === 'hold' || busyAction === 'resume' ? (
                  <ActivityIndicator color={COLORS.warning} />
                ) : (
                  <>
                    <Ionicons color={COLORS.warning} name={gateState.holdOpen ? 'play' : 'pause'} size={17} />
                    <Text style={styles.secondaryButtonText}>{gateState.holdOpen ? 'RESUME NORMAL MODE' : 'PAUSE BARRIER SENSOR'}</Text>
                  </>
                )}
              </Pressable>

              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={COLORS.staffBlue} />
                <Text style={styles.noticeText}>The status confirms the command reached the server. The hardware may take a moment to respond.</Text>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: 'center', backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.round,
    height: 38, justifyContent: 'center', width: 38,
  },
  closeGateButton: { backgroundColor: '#F43F5E' },
  connectionNote: { color: COLORS.warning, fontSize: FONT_SIZES.sm, lineHeight: 19 },
  disabledButton: { opacity: 0.45 },
  gateSelector: {
    backgroundColor: '#090A0C', borderColor: COLORS.border, borderRadius: RADIUS.md,
    borderWidth: 1, flexDirection: 'row', gap: SPACING.xs, padding: SPACING.xs,
  },
  gateTab: {
    alignItems: 'center', borderRadius: RADIUS.sm, flex: 1, flexDirection: 'row',
    gap: SPACING.xs, justifyContent: 'center', minHeight: 43, paddingHorizontal: SPACING.xs,
  },
  gateTabActive: { backgroundColor: COLORS.gold },
  gateTabText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '900' },
  gateTabTextActive: { color: COLORS.textInverse },
  headerTitleWrap: { alignItems: 'center', flexDirection: 'row', gap: SPACING.sm },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.68)', flex: 1, justifyContent: 'flex-end' },
  notice: {
    alignItems: 'flex-start', backgroundColor: 'rgba(96,180,255,0.08)', borderColor: 'rgba(96,180,255,0.2)',
    borderRadius: RADIUS.md, borderWidth: 1, flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md,
  },
  noticeText: { color: COLORS.textSecondary, flex: 1, fontSize: FONT_SIZES.xs, lineHeight: 17 },
  openGateButton: { backgroundColor: COLORS.success },
  primaryButton: {
    alignItems: 'center', borderRadius: RADIUS.md, flexDirection: 'row', gap: SPACING.sm,
    justifyContent: 'center', minHeight: 54, paddingHorizontal: SPACING.md,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: FONT_SIZES.sm, fontWeight: '900', letterSpacing: 0.5 },
  secondaryButton: {
    alignItems: 'center', backgroundColor: 'rgba(255,159,67,0.1)', borderColor: 'rgba(255,159,67,0.3)',
    borderRadius: RADIUS.md, borderWidth: 1, flexDirection: 'row', gap: SPACING.sm,
    justifyContent: 'center', minHeight: 48, paddingHorizontal: SPACING.md,
  },
  secondaryButtonText: { color: COLORS.warning, fontSize: FONT_SIZES.xs, fontWeight: '900', letterSpacing: 0.3 },
  sheet: {
    backgroundColor: COLORS.background, borderColor: COLORS.border, borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl, borderWidth: 1, maxHeight: '92%', paddingBottom: SPACING.md,
  },
  sheetContent: { gap: SPACING.md, padding: SPACING.lg, paddingBottom: SPACING.xl },
  sheetHeader: {
    alignItems: 'center', borderBottomColor: COLORS.border, borderBottomWidth: 1,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  sheetTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  statusCard: {
    alignItems: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, borderWidth: 1, flexDirection: 'row', gap: SPACING.md, minHeight: 82,
    padding: SPACING.md,
  },
  statusCardOpen: { backgroundColor: 'rgba(76,175,80,0.1)', borderColor: 'rgba(76,175,80,0.45)' },
  statusCardPaused: { backgroundColor: 'rgba(255,159,67,0.1)', borderColor: 'rgba(255,159,67,0.45)' },
  statusCopy: { flex: 1, gap: 3 },
  statusDescription: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  statusDot: { backgroundColor: COLORS.textMuted, borderRadius: 6, height: 12, width: 12 },
  statusDotOpen: { backgroundColor: COLORS.success },
  statusIcon: {
    alignItems: 'center', backgroundColor: COLORS.surfaceElevated, borderRadius: RADIUS.md,
    height: 48, justifyContent: 'center', width: 48,
  },
  statusTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xs, fontWeight: '900', letterSpacing: 0.3 },
  summaryAction: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  summaryActionText: { color: COLORS.gold, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  summaryCard: {
    alignItems: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, borderWidth: 1, flexDirection: 'row', gap: SPACING.md, minHeight: 78,
    paddingHorizontal: SPACING.md,
  },
  summaryCopy: { flex: 1, gap: 4 },
  summaryIcon: {
    alignItems: 'center', backgroundColor: 'rgba(76,175,80,0.12)', borderRadius: RADIUS.md,
    height: 44, justifyContent: 'center', width: 44,
  },
  summarySubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  summaryTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900' },
});
