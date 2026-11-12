import { useLanguage } from '@/contexts/LanguageContext';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, LoadingSpinner } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { MembershipBadge } from '@/components/profile/MembershipBadge';
import { ProfileAvatar } from '@/components/profile/ProfileAvatar';
import { ProfileInfoCard } from '@/components/profile/ProfileInfoCard';
import { useAuth } from '@/hooks/useAuth';
import { useProfileData } from '@/hooks/useProfileData';
import { colors, spacing } from '@/theme';

type ProfileNavigation = {
  navigate: (route: 'EditProfile' | 'ChangePassword' | 'VehicleList' | 'Policies') => void;
};

export const ProfileScreen = ({ navigation }: { navigation: ProfileNavigation }) => {
  const { t: translateUi } = useLanguage();
  const { user, logout, refreshUser } = useAuth();
  const { profile, loading, fetchProfile } = useProfileData();

  const displayName = user?.username || user?.email || 'Customer';

  if (loading) {
    return (
      <Screen>
        <LoadingSpinner />
      </Screen>
    );
  }

  return (
    <Screen
      scrollable
      contentStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void Promise.all([fetchProfile(), refreshUser()])} />}
    >
      <Card>
        <View style={styles.header}>
          <ProfileAvatar name={displayName} size={80} uri={profile?.avatar} />
          <View style={styles.identity}>
            <AppText variant="h2">{displayName}</AppText>
            <AppText color={colors.light.text.secondary}>{user?.email}</AppText>
            <AppText color={user?.isEmailVerified ? colors.success.main : colors.warning.main} variant="body2">
              {user?.isEmailVerified ? translateUi("Email verified") : 'Email not verified'}
            </AppText>
          </View>
        </View>
      </Card>
      <MembershipBadge membership={user?.membership} />
      <ProfileInfoCard
        rows={[
          { label: 'First name', value: profile?.firstName },
          { label: 'Last name', value: profile?.lastName },
          { label: 'Phone', value: profile?.phone },
          { label: 'Date of birth', value: profile?.dob ? new Date(profile.dob).toLocaleDateString('vi-VN') : '' },
          { label: 'Gender', value: profile?.gender },
          { label: 'Google account', value: user?.googleId ? 'Connected' : 'No' },
          { label: 'Created', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : '' },
        ]}
      />
      <Button title={translateUi("Edit Profile")} onPress={() => navigation.navigate('EditProfile')} />
      {!user?.googleId ? (
        <Button title={translateUi("Change Password")} variant="outline" onPress={() => navigation.navigate('ChangePassword')} />
      ) : null}
      <Button title={translateUi("Vehicles")} variant="outline" onPress={() => navigation.navigate('VehicleList')} />
      <Button title={translateUi("Policies")} variant="outline" onPress={() => navigation.navigate('Policies')} />
      <Button title={translateUi("Logout")} variant="ghost" onPress={logout} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
});
