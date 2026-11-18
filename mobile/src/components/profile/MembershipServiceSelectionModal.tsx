import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { Button } from '@/components/common';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  membershipServices, membershipServiceChoices, pendingServiceIds,
  type SessionServiceBenefits,
} from '@/services/api/membershipServices';

interface Props {
  session: { _id: string; licensePlate: string; parkingSlot?: string };
  onClose: () => void;
  onSaved: () => void;
}

export function MembershipServiceSelectionModal({ session, onClose, onSaved }: Props) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<SessionServiceBenefits | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const requestKey = useRef<{ signature: string; value: string } | null>(null);
  const alive = useRef(true);

  const load = async () => {
    const response = await membershipServices.benefits(session._id);
    if (!response.success || !response.data) throw new Error(response.message || 'Unable to load included services.');
    if (!alive.current) return;
    setData(response.data);
    setSelected(pendingServiceIds(response.data));
  };

  useEffect(() => {
    alive.current = true;
    void load().catch((e: unknown) => {
      if (alive.current) setError(e instanceof Error ? e.message : 'Unable to load included services.');
    }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
    // Parent keys this modal by session ID so state cannot leak between vehicles.
  }, [session._id]);

  const refresh = async () => {
    if (inFlight.current) return;
    setLoading(true);
    setError('');
    try { await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load included services.'); }
    finally { if (alive.current) setLoading(false); }
  };

  const save = async () => {
    if (!data || data.session.status !== 'active' || loading || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const serviceIds = [...selected].sort();
    const signature = JSON.stringify([session._id, data.revision, serviceIds]);
    if (requestKey.current?.signature !== signature) requestKey.current = { signature, value: Crypto.randomUUID() };
    try {
      const response = await membershipServices.select(session._id, { serviceIds, revision: data.revision, idempotencyKey: requestKey.current.value });
      if (!response.success) throw new Error(response.message || 'Unable to save service selection.');
      if (alive.current) onSaved();
    } catch (e) {
      if (!alive.current) return;
      const message = e instanceof Error ? e.message : 'Unable to save service selection.';
      if ((e as { status?: number }).status === 409) {
        try { await load(); }
        catch { setData(null); }
      }
      setError(message);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const close = () => { if (!inFlight.current) onClose(); };
  const choices = data ? membershipServiceChoices(data) : [];
  const running = data?.requests.filter((work) => work.status === 'in_progress') || [];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={styles.title}>{t('Choose membership services')}</Text>
            <Text style={styles.text}>{session.licensePlate} · {data?.session.floorName || ''} {data?.session.parkingSlot || session.parkingSlot || ''}</Text>
          </View>
          <Button title="Close" variant="ghost" disabled={busy} onPress={close} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {loading ? <ActivityIndicator color={COLORS.gold} /> : null}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
          <Button title="Refresh" variant="outline" disabled={busy || loading} onPress={() => void refresh()} />
          {data && !loading ? <>
            <Text style={styles.text}>{t('Each selected service reserves 1 included use. Staff will start the service at the parking lot.')}</Text>
            {!data.selectionEnabled && <Text style={styles.text}>{t('New selections are disabled. You can still remove pending services.')}</Text>}
            {!choices.length && <Text style={styles.text}>{t('No included services available for this vehicle.')}</Text>}
            {choices.map((choice) => {
              const checked = selected.includes(choice.serviceId);
              const disabled = busy || data.session.status !== 'active' || running.some((work) => work.serviceId === choice.serviceId)
                || (!checked && !pendingServiceIds(data).includes(choice.serviceId) && (!data.selectionEnabled || choice.available < 1));
              return <Pressable key={choice.serviceId} accessibilityRole="checkbox" accessibilityLabel={choice.serviceName}
                accessibilityState={{ checked, disabled }} disabled={disabled}
                onPress={() => setSelected((current) => checked ? current.filter((id) => id !== choice.serviceId) : [...current, choice.serviceId])}
                style={[styles.choice, checked && styles.checked, disabled && { opacity: 0.5 }]}>
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={COLORS.gold} />
                <View style={{ flex: 1 }}><Text style={styles.title}>{choice.serviceName}</Text>
                  <Text style={styles.text}>{t('Available')}: {choice.available} · {t('Reserved')}: {choice.reserved}</Text>
                  {choice.nearestExpiry && <Text style={styles.text}>{t('Expires')}: {new Date(choice.nearestExpiry).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-GB')}</Text>}
                </View>
              </Pressable>;
            })}
            {running.map((work) => <Text key={work._id} style={styles.text}>{work.serviceName} · {t('In progress')}</Text>)}
            {data.requests.filter((work) => work.status === 'done' || work.status === 'cancelled').map((work) => (
              <Text key={work._id} style={styles.text}>{work.serviceName} · {t(work.status === 'done' ? 'Completed' : 'Cancelled')}</Text>
            ))}
          </> : null}
        </ScrollView>
        <View style={styles.footer}><Button title="Save service selection" loading={busy}
          disabled={loading || !data || data.session.status !== 'active'} onPress={() => void save()} /></View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.lg },
  content: { padding: SPACING.lg, gap: SPACING.md },
  title: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  text: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },
  error: { color: COLORS.error },
  choice: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  checked: { borderColor: COLORS.gold, backgroundColor: COLORS.goldTint },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border },
});
