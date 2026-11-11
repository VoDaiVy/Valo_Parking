import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AnimatedPressable,
  PrimaryCTA,
  ProfileFormField,
  ProfileScreenHeader,
  SectionHeader,
  StaggeredView,
} from '@/components/profile/ProfileUI';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useProfileData } from '@/hooks/useProfileData';
import { useToast } from '@/hooks/useToast';
import { profileService } from '@/services/api/profile';
import { validateDateOfBirth, validateVietnamesePhone } from '@/utils/profileValidation';

type Props = { navigation: { goBack: () => void } };
type GenderOption = 'male' | 'female' | 'other';

const GENDER_OPTIONS: GenderOption[] = ['male', 'female', 'other'];

export const EditProfileScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const { profile, loading: profileLoading, updateProfile } = useProfileData();
  const imageUpload = useImageUpload();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName || '');
    setLastName(profile.lastName || '');
    setPhone(profile.phone || '');
    setDob(profile.dob ? profile.dob.slice(0, 10) : '');
    setGender(profile.gender || '');
    setAvatar(profile.avatar || undefined);
  }, [profile]);

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (phone && !validateVietnamesePhone(phone)) next.phone = 'Please enter a valid phone number.';
    const dobResult = validateDateOfBirth(dob);
    if (!dobResult.valid && dobResult.error) next.dob = dobResult.error;
    if (gender && !GENDER_OPTIONS.includes(gender as GenderOption)) next.gender = 'Choose male, female, or other.';
    return next;
  }, [dob, gender, phone]);

  const hasChanges = Boolean(
    profile &&
      (firstName !== (profile.firstName || '') ||
        lastName !== (profile.lastName || '') ||
        phone !== (profile.phone || '') ||
        dob !== (profile.dob ? profile.dob.slice(0, 10) : '') ||
        gender !== (profile.gender || '')),
  );

  const uploadAvatar = async () => {
    const asset = await imageUpload.pickSquareImage();
    if (!asset) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const processed = await imageUpload.processAvatar(asset.uri);
      const response = await profileService.uploadAvatar({
        uri: processed.uri,
        name: asset.fileName || 'avatar.jpg',
        type: asset.mimeType || 'image/jpeg',
      });
      setAvatar(response.data.avatarUrl);
      await refreshUser();
      toast.showSuccess('Profile photo updated');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload the photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async () => {
    if (Object.keys(errors).length > 0 || !hasChanges) return;
    setLoading(true);
    setError('');
    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        dob: dob.trim() || undefined,
        gender: gender.trim() as 'male' | 'female' | 'other' | undefined,
      });
      toast.showSuccess('Profile updated successfully');
      navigation.goBack();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to update the profile.');
    } finally {
      setLoading(false);
    }
  };

  const initial = (user?.username || 'C').charAt(0).toUpperCase();
  const disabled = !hasChanges || Object.keys(errors).length > 0 || loading;

  if (profileLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <ProfileScreenHeader title={translateUi("Edit profile")} subtitle={translateUi("Update your personal details")} onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        style={styles.keyboard}
      >
        <ProfileScreenHeader title={translateUi("Edit profile")} subtitle={translateUi("Update your personal details")} onBack={() => navigation.goBack()} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <StaggeredView delay={80} style={styles.avatarSection}>
            <AnimatedPressable accessibilityLabel={translateUi("Change profile photo")} disabled={uploadingAvatar} onPress={() => void uploadAvatar()}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatarHalo} />
                <View style={styles.avatarRing}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{initial}</Text>
                  )}
                </View>
                <View style={styles.editBadge}>
                  {uploadingAvatar ? (
                    <ActivityIndicator color={COLORS.background} size="small" />
                  ) : (
                    <Ionicons name="camera" size={14} color={COLORS.background} />
                  )}
                </View>
              </View>
            </AnimatedPressable>
            <Text style={styles.avatarHint}>{translateUi("Tap to change photo")}</Text>
          </StaggeredView>

          <StaggeredView delay={180} style={styles.formSection}>
            <SectionHeader title={translateUi("Name")} />
            <ProfileFormField
              autoCapitalize="words"
              icon="person-outline"
              label={translateUi("Last name")}
              placeholder={translateUi("e.g. Nguyen")}
              value={lastName}
              onChangeText={setLastName}
            />
            <ProfileFormField
              autoCapitalize="words"
              icon="person-outline"
              label={translateUi("First name")}
              placeholder={translateUi("e.g. Van A")}
              value={firstName}
              onChangeText={setFirstName}
            />
          </StaggeredView>

          <StaggeredView delay={270} style={styles.formSection}>
            <SectionHeader title={translateUi("Contact details")} />
            <ProfileFormField
              error={errors.phone}
              icon="call-outline"
              keyboardType="phone-pad"
              label={translateUi("Phone number")}
              placeholder="VD: 0912345678"
              value={phone}
              onChangeText={setPhone}
            />
            <ProfileFormField
              error={errors.dob}
              icon="calendar-outline"
              label={translateUi("Date of birth")}
              placeholder="YYYY-MM-DD"
              value={dob}
              onChangeText={setDob}
            />

            <View style={styles.genderBlock}>
              <Text style={[styles.genderLabel, errors.gender && styles.genderLabelError]}>{translateUi("Gender")}</Text>
              <View style={styles.genderOptions}>
                {GENDER_OPTIONS.map((option) => {
                  const selected = gender === option;
                  return (
                    <AnimatedPressable
                      key={option}
                      accessibilityLabel={`Select ${option}`}
                      onPress={() => setGender(option)}
                      style={[styles.genderOption, selected && styles.genderOptionSelected]}
                      tint="rgba(226,186,75,0.08)"
                    >
                      <Text style={[styles.genderText, selected && styles.genderTextSelected]}>
                        {option.charAt(0).toUpperCase() + option.slice(1)}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>
              {errors.gender ? <Text style={styles.errorText}>{errors.gender}</Text> : null}
            </View>
          </StaggeredView>

          {error ? (
            <StaggeredView delay={320} style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={17} color={COLORS.error} />
              <Text style={styles.errorBannerText}>{translateUi(error)}</Text>
            </StaggeredView>
          ) : null}

          <StaggeredView delay={390} style={styles.cta}>
            <PrimaryCTA
              disabled={disabled}
              label={translateUi("Save changes")}
              loading={loading ? <ActivityIndicator color={COLORS.textInverse} size="small" /> : undefined}
              onPress={handleSubmit}
            />
          </StaggeredView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    gap: SPACING.xl,
    paddingBottom: 118,
    paddingHorizontal: SPACING.lg,
  },
  avatarSection: {
    alignItems: 'center',
    paddingTop: SPACING.sm,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarHalo: {
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderRadius: 66,
    height: 132,
    left: -18,
    position: 'absolute',
    top: -18,
    width: 132,
  },
  avatarRing: {
    alignItems: 'center',
    backgroundColor: COLORS.goldDark,
    borderColor: COLORS.gold,
    borderRadius: 48,
    borderWidth: 2.5,
    height: 96,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 96,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.hero,
    fontWeight: '900',
  },
  editBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 2,
    bottom: 0,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 28,
  },
  avatarHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: SPACING.sm,
  },
  formSection: {
    gap: SPACING.md,
  },
  genderBlock: {
    gap: SPACING.sm,
  },
  genderLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    fontWeight: '700',
  },
  genderLabelError: {
    color: COLORS.error,
  },
  genderOptions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  genderOption: {
    flex: 1,
  },
  genderOptionSelected: {
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
  },
  genderText: {
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    fontWeight: '600',
    minHeight: 46,
    paddingVertical: 12,
    textAlign: 'center',
  },
  genderTextSelected: {
    backgroundColor: 'rgba(226,186,75,0.13)',
    borderColor: 'rgba(226,186,75,0.38)',
    color: COLORS.goldLight,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.errorTint,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  errorBannerText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  cta: {
    marginTop: SPACING.xs,
  },
});
