import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchProfile, type Profile } from '../../api/profile.api';
import { useAuth } from '@/hooks/useAuth';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '../../constants/theme';
import { CustomerAmbientBackground } from '@/components/customer/CustomerAmbientBackground';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { subscriptionsService } from '@/services/api/subscriptions';
import type { MembershipStatus } from '@/types/subscription.types';
import {
  getMembershipTierLabel,
  getMembershipVisualTier,
  MEMBERSHIP_TIER_COLORS,
  type MembershipVisualTier,
} from '@/utils/membershipDisplay';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const MEMBERSHIP_THEMES: Record<MembershipVisualTier, {
  accent: string;
  avatarBackground: string;
  avatarText: string;
  border: string;
  gradient: [string, string];
  pillBackground: string;
}> = {
  standard: {
    ...MEMBERSHIP_TIER_COLORS.standard,
    border: 'rgba(148,163,184,0.28)',
    gradient: ['rgba(148,163,184,0.09)', 'rgba(148,163,184,0.02)'],
    pillBackground: 'rgba(148,163,184,0.12)',
  },
  monthly: {
    ...MEMBERSHIP_TIER_COLORS.monthly,
    border: 'rgba(212,175,55,0.38)',
    gradient: ['rgba(212,175,55,0.14)', 'rgba(212,175,55,0.03)'],
    pillBackground: 'rgba(212,175,55,0.12)',
  },
  yearly: {
    ...MEMBERSHIP_TIER_COLORS.yearly,
    border: 'rgba(168,85,247,0.46)',
    gradient: ['rgba(168,85,247,0.18)', 'rgba(76,29,149,0.04)'],
    pillBackground: 'rgba(168,85,247,0.14)',
  },
};

function useEntrance(delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      delay,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, progress]);

  return progress;
}

function StaggeredView({
  children,
  delay,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  style?: object;
}) {
  const entrance = useEntrance(delay);

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
                outputRange: [16, 0],
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

function AnimatedPressable({
  children,
  danger,
  onPress,
  style,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onPress?: () => void;
  style?: object;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 16,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
        style={({ pressed }) => [
          pressed && (danger ? styles.pressDanger : styles.pressHighlight),
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function RoleBadge({
  label,
  theme,
}: {
  label: string;
  theme: (typeof MEMBERSHIP_THEMES)[MembershipVisualTier];
}) {
  return (
    <View style={[styles.rolePill, { backgroundColor: theme.pillBackground }]}>
      <Ionicons name="shield-checkmark-outline" size={12} color={theme.accent} />
      <Text numberOfLines={1} style={[styles.rolePillText, { color: theme.accent }]}>
        {label}
      </Text>
    </View>
  );
}

function AvatarButton({
  avatarUri,
  initial,
  theme,
  onPress,
}: {
  avatarUri?: string;
  initial: string;
  theme: (typeof MEMBERSHIP_THEMES)[MembershipVisualTier];
  onPress?: () => void;
}) {
  const entrance = useEntrance(170);
  const scale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <AnimatedPressable onPress={onPress} style={styles.avatarPress}>
      <Animated.View
        style={[
          styles.avatarWrap,
          {
            opacity: entrance,
            transform: [{ scale }],
          },
        ]}
      >
        <View
          style={[
            styles.avatarRing,
            {
              backgroundColor: theme.avatarBackground,
              borderColor: theme.accent,
            },
          ]}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <Text style={[styles.avatarText, { color: theme.avatarText }]}>{initial}</Text>
          )}
        </View>
        <View style={[styles.editBadge, { backgroundColor: theme.accent }]}>
          <Ionicons name="camera-outline" size={13} color={COLORS.textInverse} />
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

function ProfileHero({
  accountBadge,
  avatarUri,
  displayName,
  email,
  initial,
  loading,
  theme,
  onEdit,
}: {
  accountBadge: string;
  avatarUri?: string;
  displayName: string;
  email: string;
  initial: string;
  loading: boolean;
  theme: (typeof MEMBERSHIP_THEMES)[MembershipVisualTier];
  onEdit?: () => void;
}) {
  return (
    <StaggeredView delay={90} style={styles.profileHero}>
      {loading ? (
        <View style={styles.heroLoading}>
          <ActivityIndicator color={COLORS.gold} />
        </View>
      ) : (
        <>
          <AvatarButton avatarUri={avatarUri} initial={initial} theme={theme} onPress={onEdit} />
          <View style={styles.heroCopy}>
            <Text numberOfLines={1} style={styles.profileName}>{displayName}</Text>
            <RoleBadge label={accountBadge} theme={theme} />
            <Text numberOfLines={1} style={styles.profileEmail}>{email}</Text>
          </View>
          <AnimatedPressable onPress={onEdit} style={styles.editProfileButton}>
            <View style={styles.editProfileContent}>
            <Text style={styles.editProfileText}>View profile</Text>
              <Ionicons name="chevron-forward" size={15} color={COLORS.gold} />
            </View>
          </AnimatedPressable>
        </>
      )}
    </StaggeredView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

function SettingsRow({
  danger,
  icon,
  iconBg,
  iconColor,
  label,
  showArrow = true,
  sublabel,
  onPress,
}: {
  danger?: boolean;
  icon: IconName;
  iconBg: string;
  iconColor: string;
  label: string;
  showArrow?: boolean;
  sublabel?: string;
  onPress?: () => void;
}) {
  const arrow = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  const translateX = arrow.interpolate({ inputRange: [0, 1], outputRange: [0, 4] });
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });

  const animateArrow = (toValue: number) => {
    Animated.spring(arrow, {
      damping: 16,
      mass: 0.5,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 16,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => {
          animateArrow(1);
          animatePress(1);
        }}
        onPressOut={() => {
          animateArrow(0);
          animatePress(0);
        }}
        style={({ pressed }) => [
          styles.settingsRow,
          pressed && (danger ? styles.pressDanger : styles.pressHighlight),
        ]}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={19} color={iconColor} />
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowLabel, danger && styles.dangerText]}>{label}</Text>
          {sublabel ? (
            <Text numberOfLines={1} style={styles.rowSublabel}>{sublabel}</Text>
          ) : null}
        </View>
        {showArrow ? (
          <Animated.View style={{ transform: [{ translateX }] }}>
            <Ionicons name="chevron-forward" size={17} color={COLORS.textMuted} />
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function SettingsSection({
  delay,
  rows,
  title,
}: {
  delay: number;
  rows: Array<React.ComponentProps<typeof SettingsRow>>;
  title: string;
}) {
  return (
    <StaggeredView delay={delay} style={styles.sectionBlock}>
      <SectionHeader title={title} />
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <View key={`${row.label}-${index}`}>
            <StaggeredView delay={delay + index * 35}>
              <SettingsRow {...row} />
            </StaggeredView>
            {index < rows.length - 1 ? <View style={styles.rowDivider} /> : null}
          </View>
        ))}
      </View>
    </StaggeredView>
  );
}

export default function ProfileScreen({ navigation }: { navigation?: any }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { alert } = useAppAlert();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const [profileResult, membershipResult] = await Promise.allSettled([
        fetchProfile(),
        subscriptionsService.getMembership(),
      ]);
      if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
      if (membershipResult.status === 'fulfilled') {
        setMembership(membershipResult.value.data || null);
      }
    } catch {
      // use auth context data
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

  const handleLogout = () => {
    alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  };

  const displayName = profile?.fullName || user?.username || 'User';
  const email = profile?.email || user?.email || '';
  const initial = displayName.charAt(0).toUpperCase();
  const roleBadge = user?.role === 'customer' ? 'Customer' : user?.role ?? '';
  const membershipTier = getMembershipVisualTier(membership);
  const membershipTheme = MEMBERSHIP_THEMES[membershipTier];
  const accountBadge = user?.role === 'customer'
    ? getMembershipTierLabel(membershipTier)
    : roleBadge;
  const avatarUri = profile?.avatar || user?.avatar || undefined;
  const walletSublabel = profile?.wallet?.balance !== undefined
    ? `Balance: ${profile.wallet.balance.toLocaleString('en-US')} VND`
    : 'Manage your balance';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <CustomerAmbientBackground />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.gold}
            colors={[COLORS.gold]}
          />
        }
      >
        <StaggeredView delay={20} style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('account')}</Text>
        </StaggeredView>

        <ProfileHero
          accountBadge={accountBadge}
          avatarUri={avatarUri}
          displayName={displayName}
          email={email}
          initial={initial}
          loading={loading}
          theme={membershipTheme}
          onEdit={() => navigation?.navigate?.('PersonalProfile')}
        />

        <SettingsSection
          delay={190}
            title="My account"
          rows={[
            {
              icon: 'person-outline',
              iconBg: 'rgba(78,205,196,0.12)',
              iconColor: '#4ECDC4',
              label: 'Personal profile',
              sublabel: 'Personal information',
              onPress: () => navigation?.navigate?.('PersonalProfile'),
            },
            {
              icon: 'car-outline',
              iconBg: 'rgba(126,232,162,0.12)',
              iconColor: '#7EE8A2',
              label: 'My vehicles',
              sublabel: 'Manage vehicles',
              onPress: () => navigation?.navigate?.('VehicleList'),
            },
            {
              icon: 'calendar-outline',
              iconBg: 'rgba(78,205,196,0.12)',
              iconColor: '#4ECDC4',
              label: 'My bookings',
              sublabel: 'Manage upcoming reservations',
              onPress: () => navigation?.navigate?.('BookingList'),
            },
            {
              icon: 'ribbon-outline',
              iconBg: 'rgba(255,215,0,0.12)',
              iconColor: '#FFD700',
              label: 'Membership plans',
              sublabel: 'VIP access and benefits',
              onPress: () => navigation?.navigate?.('WalletTab', { screen: 'Membership' }),
            },
            {
              icon: 'receipt-outline',
              iconBg: 'rgba(224,123,224,0.12)',
              iconColor: '#E07BE0',
              label: 'Parking history',
              sublabel: 'View sessions and receipts',
              onPress: () => navigation?.navigate?.('ParkingHistory'),
            },
            {
              icon: 'wallet-outline',
              iconBg: 'rgba(255,159,67,0.12)',
              iconColor: '#FF9F43',
              label: 'VALO Wallet',
              sublabel: walletSublabel,
              onPress: () => navigation?.navigate?.('WalletTab'),
            },
            {
              icon: 'gift-outline',
              iconBg: 'rgba(226,186,75,0.12)',
              iconColor: COLORS.gold,
              label: 'Voucher & rewards',
              sublabel: 'View your vouchers and spending rewards',
              onPress: () => navigation?.navigate?.('WalletTab', { screen: 'Rewards' }),
            },
          ]}
        />

        <SettingsSection
          delay={430}
          title="Settings"
          rows={[
            {
              icon: 'notifications-outline',
              iconBg: 'rgba(96,180,255,0.12)',
              iconColor: '#60B4FF',
              label: 'Notifications',
              onPress: () => navigation?.navigate?.('NotificationsTab'),
            },
            {
              icon: 'lock-closed-outline',
              iconBg: COLORS.surfaceElevated,
              iconColor: COLORS.textSecondary,
              label: 'Change password',
              onPress: () => navigation?.navigate?.('ChangePassword'),
            },
            {
              icon: 'sparkles-outline',
              iconBg: 'rgba(126,232,162,0.12)',
              iconColor: '#7EE8A2',
              label: 'Services',
              sublabel: 'Pricing and turnaround times',
              onPress: () => navigation?.navigate?.('Services'),
            },
            {
              icon: 'document-text-outline',
              iconBg: COLORS.surfaceElevated,
              iconColor: COLORS.textSecondary,
              label: 'Policies and terms',
              onPress: () => navigation?.navigate?.('Policies'),
            },
          ]}
        />

        <StaggeredView delay={620} style={styles.logoutBlock}>
          <View style={styles.fullDivider} />
          <SettingsRow
            danger
            icon="log-out-outline"
            iconBg="rgba(255,77,77,0.12)"
            iconColor={COLORS.error}
            label="Sign out"
            showArrow={false}
            onPress={handleLogout}
          />
        </StaggeredView>

        <StaggeredView delay={680} style={styles.versionBlock}>
          <Text style={styles.versionBrand}>VALO Parking</Text>
          <Text style={styles.versionText}>Version 1.0.0</Text>
        </StaggeredView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: {
    paddingBottom: 116,
    paddingHorizontal: SPACING.lg,
  },

  pageHeader: {
    paddingTop: SPACING.md,
  },
  pageTitle: {
    color: COLORS.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0,
  },

  profileHero: {
    alignItems: 'center',
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  heroLoading: {
    alignItems: 'center',
    height: 206,
    justifyContent: 'center',
  },
  avatarPress: {
    borderRadius: RADIUS.round,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarRing: {
    alignItems: 'center',
    borderRadius: 48,
    borderWidth: 2,
    height: 96,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    width: 96,
  },
  avatarImage: { height: '100%', width: '100%' },
  avatarText: {
    fontSize: 36,
    fontWeight: '900',
  },
  editBadge: {
    alignItems: 'center',
    borderColor: COLORS.background,
    borderRadius: 15,
    borderWidth: 2,
    bottom: 2,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    width: 30,
  },
  heroCopy: {
    alignItems: 'center',
    marginTop: SPACING.md,
    maxWidth: '100%',
  },
  profileName: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    maxWidth: '100%',
  },
  profileEmail: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginTop: SPACING.xs,
    maxWidth: '92%',
  },
  rolePill: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 5,
    marginTop: SPACING.sm,
    maxWidth: '88%',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  rolePillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  editProfileButton: {
    borderRadius: RADIUS.round,
    marginTop: SPACING.md,
    overflow: 'hidden',
  },
  editProfileContent: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.1)',
    borderColor: 'rgba(226,186,75,0.24)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  editProfileText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
  },

  sectionBlock: {
    marginTop: SPACING.lg,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  sectionTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  sectionRule: {
    backgroundColor: COLORS.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  rows: {
    gap: 0,
  },
  settingsRow: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 68,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
  rowSublabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 3,
  },
  rowDivider: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
  },
  fullDivider: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginBottom: SPACING.xs,
  },
  logoutBlock: {
    marginTop: SPACING.lg,
  },
  dangerText: {
    color: COLORS.error,
  },
  pressHighlight: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderRadius: RADIUS.md,
  },
  pressDanger: {
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderRadius: RADIUS.md,
  },

  versionBlock: {
    alignItems: 'center',
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.xl,
  },
  versionBrand: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
    opacity: 0.58,
  },
  versionText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 3,
    opacity: 0.42,
  },
});
