import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  PrimaryCTA,
  ProfileDetailRow,
  ProfileScreenHeader,
  SectionHeader,
  StaggeredView,
  useProfileEntrance,
} from '@/components/profile/ProfileUI';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useProfileData } from '@/hooks/useProfileData';
import type { ProfileStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'PersonalProfile'>;

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd MMM yyyy');
}

function formatGender(value?: string | null) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const PersonalProfileScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const { user } = useAuth();
  const { error, fetchProfile, loading, profile } = useProfileData();
  const avatarEntrance = useProfileEntrance(110);

  useFocusEffect(
    useCallback(() => {
      void fetchProfile();
    }, [fetchProfile]),
  );

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const displayName = fullName || user?.username || 'Customer';
  const email = user?.email || '';
  const role = user?.role === 'customer' ? 'Customer' : user?.role || 'Account';
  const avatar = profile?.avatar || user?.avatar || undefined;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ProfileScreenHeader
        title={translateUi("Personal profile")}
        subtitle={translateUi("Your account information")}
        onBack={() => navigation.goBack()}
      />

      {loading && !profile ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={loading} tintColor={COLORS.gold} colors={[COLORS.gold]} onRefresh={fetchProfile} />
          }
          showsVerticalScrollIndicator={false}
        >
          <StaggeredView delay={80} style={styles.hero}>
            <View style={styles.halo} />
            <Animated.View
              style={{
                opacity: avatarEntrance,
                transform: [
                  {
                    scale: avatarEntrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.88, 1],
                    }),
                  },
                ],
              }}
            >
              <View style={styles.avatarRing}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{initial}</Text>
                )}
              </View>
            </Animated.View>
            <Text numberOfLines={1} style={styles.displayName}>{displayName}</Text>
            <Text numberOfLines={1} style={styles.email}>{email || translateUi("No email available")}</Text>
            <View style={styles.rolePill}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.gold} />
              <Text numberOfLines={1} style={styles.roleText}>{role}</Text>
            </View>
          </StaggeredView>

          <StaggeredView delay={210} style={styles.details}>
            <SectionHeader title={translateUi("Personal details")} />
            <ProfileDetailRow icon="call-outline" label={translateUi("Phone number")} value={profile?.phone} />
            <ProfileDetailRow icon="calendar-outline" label={translateUi("Date of birth")} value={formatDate(profile?.dob)} />
            <ProfileDetailRow icon="person-outline" label={translateUi("Gender")} value={formatGender(profile?.gender)} />
            <ProfileDetailRow icon="mail-outline" label="Email" value={email} />
            <ProfileDetailRow icon="shield-outline" label={translateUi("Role")} value={role} />
          </StaggeredView>

          {error ? (
            <StaggeredView delay={260} style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={17} color={COLORS.error} />
              <Text style={styles.errorText}>{translateUi(error)}</Text>
            </StaggeredView>
          ) : null}

          <StaggeredView delay={330} style={styles.cta}>
            <PrimaryCTA label={translateUi("Edit profile")} onPress={() => navigation.navigate('EditProfile')} />
          </StaggeredView>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    paddingBottom: 118,
    paddingHorizontal: SPACING.lg,
  },
  hero: {
    alignItems: 'center',
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
  },
  halo: {
    backgroundColor: 'rgba(226,186,75,0.09)',
    borderRadius: 82,
    height: 164,
    position: 'absolute',
    top: 2,
    width: 164,
  },
  avatarRing: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.16)',
    borderColor: COLORS.gold,
    borderRadius: 55,
    borderWidth: 2,
    height: 110,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    width: 110,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: COLORS.goldLight,
    fontSize: 42,
    fontWeight: '900',
  },
  displayName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    lineHeight: 32,
    fontWeight: '700',
    marginTop: SPACING.md,
    maxWidth: '100%',
  },
  email: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    fontWeight: '500',
    marginTop: 5,
    maxWidth: '92%',
  },
  rolePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(226,186,75,0.1)',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 6,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  roleText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
  },
  details: {
    marginTop: SPACING.sm,
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.errorTint,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
    padding: SPACING.md,
  },
  errorText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  cta: {
    marginTop: SPACING.xl,
  },
});
