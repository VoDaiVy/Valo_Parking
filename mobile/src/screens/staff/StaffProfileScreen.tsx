import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchProfile, type Profile } from '@/api/profile.api';
import {
  ConfirmationPanel,
  FadeInView,
  OperationalRow,
  SectionTitle,
  SkeletonBlock,
  StaffHeader,
  StatusBadge,
} from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StaffProfileStackParamList, StaffTabParamList } from '@/navigation/StaffNavigator';

type Props = NativeStackScreenProps<StaffProfileStackParamList, 'StaffProfileHome'>;

export default function StaffProfileScreen({ navigation }: Props) {
  const tabBarHeight = useBottomTabBarHeight();
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch {
      // Auth context remains the fallback source for staff identity.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  };

  const displayName = profile?.fullName || user?.username || 'Staff member';
  const email = profile?.email || user?.email || '';
  const initial = displayName.charAt(0).toUpperCase();
  const goToTab = (screen: keyof StaffTabParamList) => navigation.getParent()?.navigate(screen);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow={t('staffProfile')}
        title={t('profile')}
        right={<StatusBadge label="Ops" />}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + SPACING.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />}
        showsVerticalScrollIndicator={false}
      >
        <FadeInView>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.identityCopy}>
              {loading ? (
                <>
                  <SkeletonBlock height={24} width="70%" />
                  <SkeletonBlock height={14} width="55%" />
                </>
              ) : (
                <>
                  <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
                  <Text numberOfLines={1} style={styles.email}>{email || 'No email available'}</Text>
                </>
              )}
              <View style={styles.roleLine}>
                <StatusBadge label={t('operationsStaff')} tone="success" />
              </View>
            </View>
          </View>
        </FadeInView>

        <FadeInView delay={70} style={styles.block}>
          <SectionTitle title={t('workShortcuts')} />
          <View style={styles.list}>
            <OperationalRow icon="qr-code-outline" meta={t('fast')} title={t('bookingScanner')} onPress={() => navigation.getParent()?.navigate('Manage', { screen: 'BookingScanner' })} />
            <OperationalRow icon="map-outline" title={t('liveParkingGrid')} onPress={() => goToTab('LiveGrid')} />
            <OperationalRow icon="car-sport-outline" title={t('parkingSessions')} onPress={() => goToTab('Sessions')} />
            <OperationalRow icon="notifications-outline" title={t('operationalNotices')} onPress={() => navigation.getParent()?.navigate('Manage', { screen: 'StaffNotifications' })} />
          </View>
        </FadeInView>

        <FadeInView delay={120} style={styles.block}>
          <SectionTitle title={t('account')} />
          <View style={styles.list}>
            <OperationalRow icon="person-outline" title={t('editProfile')} onPress={() => navigation.navigate('EditProfile')} />
            <OperationalRow icon="lock-closed-outline" title={t('changePassword')} tone="muted" onPress={() => navigation.navigate('ChangePassword')} />
            <OperationalRow icon="log-out-outline" meta={t('secure')} title={t('signOut')} tone="danger" onPress={() => setLogoutOpen(true)} />
          </View>
        </FadeInView>
      </ScrollView>

      <ConfirmationPanel
        confirmLabel={t('signOut')}
        message={t('signOutMessage')}
        title={t('signOutQuestion')}
        tone="danger"
        visible={logoutOpen}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          setLogoutOpen(false);
          logout();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scroll: { gap: SPACING.md, padding: SPACING.lg },
  identity: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    paddingBottom: SPACING.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.round,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  avatarText: { color: COLORS.textInverse, fontSize: 25, fontWeight: '900' },
  identityCopy: { flex: 1, gap: 5, minWidth: 0 },
  name: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '900' },
  email: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  roleLine: { marginTop: 4 },
  block: { gap: SPACING.md },
  list: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth },
});
