import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileScreenHeader } from '@/components/profile/ProfileUI';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { telegramService, type TelegramLinkStatus } from '@/services/api/telegram';

export function TelegramSettingsScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const [status, setStatus] = useState<TelegramLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const response = await telegramService.status(); setStatus(response.data || null); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load Telegram settings.'); }
  }, []);
  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => subscription.remove();
  }, [refresh]);
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update Telegram settings.'); }
    finally { setBusy(false); }
  };
  const link = () => run(async () => {
    const response = await telegramService.link();
    if (!response.data?.deepLink) throw new Error('Telegram link was not returned.');
    await Linking.openURL(response.data.deepLink);
  });
  return <SafeAreaView style={styles.screen}>
    <ProfileScreenHeader title="Telegram tickets" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Your parking ticket, ready to scan</Text>
      <Text style={styles.text}>Receive booking details and the same QR used at the entry kiosk, exit kiosk or with parking staff.</Text>
      <View style={styles.card}>
        <Text style={styles.title}>{status?.linked ? 'Telegram connected' : 'Connect Telegram'}</Text>
        <Text style={styles.text}>{status?.linked ? (status.username ? `@${status.username}` : 'Your private Telegram chat') : 'Open the VALO bot, press Start and share your own contact to finish linking.'}</Text>
        {status?.linked ? <View style={styles.row}><Text style={styles.text}>Receive tickets and updates</Text><Switch disabled={busy} value={status.notificationsEnabled} onValueChange={value => void run(() => telegramService.preferences(value))} /></View> : null}
      </View>
      {busy || !status && !error ? <ActivityIndicator color={COLORS.gold} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!status?.linked ? <TouchableOpacity disabled={busy} style={styles.button} onPress={() => void link()}><Text style={styles.buttonText}>Open Telegram to connect</Text></TouchableOpacity> : <TouchableOpacity disabled={busy} style={styles.button} onPress={() => Alert.alert('Disconnect Telegram?', 'Future parking tickets will no longer be sent to this chat.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => void run(() => telegramService.unlink()) }])}><Text style={styles.buttonText}>Disconnect Telegram</Text></TouchableOpacity>}
      <TouchableOpacity disabled={busy} style={styles.button} onPress={() => void refresh()}><Text style={styles.buttonText}>Refresh connection</Text></TouchableOpacity>
      <Text style={styles.text}>You can continue booking and parking without connecting Telegram.</Text>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, gap: SPACING.lg },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', lineHeight: 28 },
  text: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 23, flexShrink: 1 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md },
  button: { minHeight: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md },
  buttonText: { color: COLORS.gold, fontSize: 16, fontWeight: '700' },
  error: { color: COLORS.error, lineHeight: 22 },
});
