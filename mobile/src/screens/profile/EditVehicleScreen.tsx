import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common';
import { useToast } from '@/hooks/useToast';
import type { ProfileStackParamList } from '@/navigation/types';
import { vehiclesService } from '@/services/api/vehicles';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { typography } from '@/theme';
import { useAppAlert } from '@/contexts/AppAlertContext';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditVehicle'>;

export const EditVehicleScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const { alert } = useAppAlert();
  const [brand, setBrand] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [nickname, setNickname] = useState('');
  const [hexColor, setHexColor] = useState('#ffffff');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadVehicle = async () => {
      try {
        const response = await vehiclesService.getVehicleById(route.params.vehicleId);
        if (response.data) {
          setLicensePlate(response.data.licensePlate);
          setBrand(response.data.brand);
          setModel(response.data.model);
          setColor(response.data.color);
          setNickname(response.data.nickname || '');
          setHexColor(response.data.hexColor || '#ffffff');
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load vehicles.');
      } finally {
        setLoading(false);
      }
    };

    void loadVehicle();
  }, [route.params.vehicleId]);

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      await vehiclesService.updateVehicle(route.params.vehicleId, {
        brand: brand.trim(),
        model: model.trim(),
        color: color.trim(),
        nickname: nickname.trim(),
        hexColor,
      });
      toast.showSuccess('Vehicle updated successfully');
      navigation.goBack();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to update the vehicle.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    alert('Delete vehicle', 'Are you sure you want to delete this vehicle?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await vehiclesService.deleteVehicle(route.params.vehicleId);
            toast.showSuccess('Vehicle deleted');
            navigation.goBack();
          } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the vehicle.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const handleSetDefault = async () => {
    setSaving(true);
    try {
      await vehiclesService.setDefaultVehicle(route.params.vehicleId);
      toast.showSuccess('Default vehicle updated');
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set the default vehicle.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <ScreenHeader title={translateUi("Edit vehicle")} onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={translateUi("Edit vehicle")} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        <View style={styles.vehicleSummary}>
          <View style={styles.summaryIcon}><Ionicons name="car-sport-outline" size={30} color={COLORS.gold} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryPlate}>{licensePlate || translateUi('Vehicle')}</Text>
            <Text style={styles.summaryDescription}>{[brand, model].filter(Boolean).join(' ') || translateUi('Vehicle details')}</Text>
          </View>
        </View>
        <View style={styles.formCard}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{translateUi("Make")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="VD: TOYOTA"
                placeholderTextColor={COLORS.textMuted}
                value={brand}
                onChangeText={setBrand}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{translateUi("Model")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="VD: VIOS"
                placeholderTextColor={COLORS.textMuted}
                value={model}
                onChangeText={setModel}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{translateUi("Color")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={translateUi("e.g. White")}
                placeholderTextColor={COLORS.textMuted}
                value={color}
                onChangeText={setColor}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{translateUi("Vehicle nickname")}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={translateUi("Name or nickname")}
                placeholderTextColor={COLORS.textMuted}
                value={nickname}
                onChangeText={setNickname}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{translateUi("Hex color code")}</Text>
            <View style={styles.inputWrap}>
              <View style={[styles.colorPreview, { backgroundColor: hexColor }]} />
              <TextInput
                style={styles.input}
                placeholder="#ffffff"
                placeholderTextColor={COLORS.textMuted}
                value={hexColor}
                onChangeText={setHexColor}
              />
            </View>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{translateUi(error)}</Text> : null}

        <TouchableOpacity 
          activeOpacity={0.8} 
          style={[styles.primaryButton, saving && styles.disabled]} 
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.textInverse} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>{translateUi("Save changes")}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.8} 
          style={[styles.outlineButton, saving && styles.disabled]} 
          onPress={handleSetDefault}
          disabled={saving}
        >
          <Ionicons name="star-outline" size={20} color={COLORS.gold} />
          <Text style={styles.outlineButtonText}>{translateUi("Set as default vehicle")}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          activeOpacity={0.8} 
          style={[styles.ghostButton, saving && styles.disabled]} 
          onPress={handleDelete}
          disabled={saving}
        >
          <Ionicons name="trash-outline" size={20} color={COLORS.error} />
          <Text style={styles.ghostButtonText}>{translateUi("Delete vehicle")}</Text>
        </TouchableOpacity>

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  vehicleSummary: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  summaryIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: COLORS.goldTint, alignItems: 'center', justifyContent: 'center' },
  summaryPlate: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  summaryDescription: { color: COLORS.textSecondary, fontSize: 14, marginTop: 6, lineHeight: 20 },
  keyboard: { flex: 1 },
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  formCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  inputGroup: {
    gap: SPACING.xs,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    minHeight: 48,
  },
  input: {
    ...typography.body1,
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
  },
  colorPreview: {
    width: 20,
    height: 20,
    borderRadius: RADIUS.round,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outlineButton: {
    borderColor: 'rgba(212,175,55,0.3)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    minHeight: 52,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  ghostButton: {
    minHeight: 52,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  disabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    ...typography.button,
    textAlign: 'center',
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  outlineButtonText: {
    ...typography.button,
    flexShrink: 1,
    textAlign: 'center',
    color: COLORS.gold,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  ghostButtonText: {
    ...typography.button,
    flexShrink: 1,
    textAlign: 'center',
    color: COLORS.error,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
