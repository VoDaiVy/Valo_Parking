import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useToast } from '@/hooks/useToast';
import { vehiclesService } from '@/services/api/vehicles';
import type { VehicleType } from '@/types/models';
import { isValidNormalizedLicensePlate, normalizeLicensePlate } from '@/utils/profileValidation';
import { getCenteredCropForAspect } from '@/utils/registrationCardImage';

export const AddVehicleScreen = ({ navigation }: { navigation: { goBack: () => void } }) => {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const toast = useToast();
  const [licensePlate, setLicensePlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [nickname, setNickname] = useState('');
  const [hexColor, setHexColor] = useState('#ffffff');
  const [registrationCardImage, setRegistrationCardImage] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const normalizedPlate = normalizeLicensePlate(licensePlate);
    if (!isValidNormalizedLicensePlate(normalizedPlate)) {
      setError('Please enter a valid license plate.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await vehiclesService.addVehicle({
        licensePlate: normalizedPlate,
        vehicleType,
        brand: brand.trim(),
        model: model.trim(),
        color: color.trim(),
        nickname: nickname.trim(),
        hexColor,
        registrationCardImage,
      });
      toast.showSuccess('Vehicle added successfully');
      navigation.goBack();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to add the vehicle.');
    } finally {
      setLoading(false);
    }
  };

  const openRegistrationCardCamera = async () => {
    setError('');
    let granted = cameraPermission?.granted || false;
    if (!granted) {
      const permission = await requestCameraPermission();
      granted = permission.granted;
    }
    if (!granted) {
      setError('Camera permission is required to photograph the vehicle registration.');
      return;
    }
    setCameraOpen(true);
  };

  const captureAndScanRegistrationCard = async () => {
    if (!cameraRef.current || scanning) return;
    setScanning(true);
    setScanCompleted(false);
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!photo?.uri || !photo.width || !photo.height) {
        throw new Error('Unable to capture the photo. Please try again.');
      }

      const crop = getCenteredCropForAspect(photo.width, photo.height);
      const processed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ crop }, { resize: { width: 1024 } }],
        {
          base64: true,
          compress: 0.85,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );
      if (!processed.base64) throw new Error('Unable to process the registration photo.');

      const base64Image = `data:image/jpeg;base64,${processed.base64}`;
      setRegistrationCardImage(base64Image);
      setCameraOpen(false);

      const scanRes = await vehiclesService.scanRegistrationCard(base64Image);
      if (!scanRes.data) throw new Error('The registration details could not be read.');

      const {
        nickname: scannedNick,
        brand: scannedBrand,
        model: scannedModel,
        licensePlate: scannedPlate,
        colorText,
        hexColor: scannedHex,
      } = scanRes.data;

      if (scannedNick) setNickname(scannedNick);
      if (scannedBrand) setBrand(scannedBrand);
      if (scannedModel) setModel(scannedModel);
      if (scannedPlate) setLicensePlate(normalizeLicensePlate(scannedPlate));
      if (colorText) setColor(colorText);
      if (scannedHex) setHexColor(scannedHex);
      setScanCompleted(true);
      toast.showSuccess('Vehicle registration details extracted');
    } catch (scanErr) {
      setError(scanErr instanceof Error ? scanErr.message : 'Unable to scan the registration details.');
    } finally {
      setScanning(false);
    }
  };

  if (cameraOpen) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.cameraScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#050505" />
        <View style={styles.cameraHeader}>
          <TouchableOpacity style={styles.cameraHeaderButton} onPress={() => setCameraOpen(false)} disabled={scanning}>
            <Ionicons name="close" size={28} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.cameraTitle}>Photograph vehicle registration</Text>
          <TouchableOpacity style={styles.cameraHeaderButton} onPress={() => setTorchEnabled((current) => !current)}>
            <Ionicons name={torchEnabled ? 'flash' : 'flash-off'} size={23} color={torchEnabled ? COLORS.gold : COLORS.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.cameraBody}>
          <Text style={styles.cameraGuide}>Fit the entire registration card inside the 9 × 6 cm frame</Text>
          <View style={styles.cardCameraFrame}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torchEnabled} />
            <View pointerEvents="none" style={styles.frameBorder}>
              <View style={[styles.frameCorner, styles.frameCornerTopLeft]} />
              <View style={[styles.frameCorner, styles.frameCornerTopRight]} />
              <View style={[styles.frameCorner, styles.frameCornerBottomLeft]} />
              <View style={[styles.frameCorner, styles.frameCornerBottomRight]} />
            </View>
          </View>
          <View style={styles.cameraTips}>
            <Ionicons name="sunny-outline" size={18} color={COLORS.gold} />
            <Text style={styles.cameraTipText}>Keep it straight, avoid glare, and make sure all text is clear</Text>
          </View>
        </View>

        <View style={styles.captureControls}>
          <TouchableOpacity
            accessibilityLabel="Photograph vehicle registration"
            activeOpacity={0.8}
            disabled={scanning}
            style={[styles.captureButtonOuter, scanning && styles.disabled]}
            onPress={captureAndScanRegistrationCard}
          >
            {scanning ? <ActivityIndicator color={COLORS.gold} /> : <View style={styles.captureButtonInner} />}
          </TouchableOpacity>
          <Text style={styles.captureLabel}>{scanning ? 'Processing photo...' : 'Tap to capture'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <ScreenHeader title="Add vehicle" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        
        <TouchableOpacity activeOpacity={0.8} style={styles.scanButton} onPress={openRegistrationCardCamera} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator color={COLORS.gold} />
          ) : (
            <>
              <Ionicons name={scanCompleted ? "checkmark-circle" : "camera-outline"} size={24} color={scanCompleted ? COLORS.success : COLORS.gold} />
              <Text style={styles.scanButtonText}>
                {scanCompleted ? 'Registration scanned (Retake)' : 'Scan vehicle registration'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.formCard}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>License plate</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="VD: 51H12345"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
                value={licensePlate}
                onChangeText={setLicensePlate}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Vehicle type</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="car or electric_car"
                placeholderTextColor={COLORS.textMuted}
                value={vehicleType}
                onChangeText={(val) => setVehicleType(val as VehicleType)}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Make</Text>
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
            <Text style={styles.label}>Model</Text>
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
            <Text style={styles.label}>Color</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="e.g. White"
                placeholderTextColor={COLORS.textMuted}
                value={color}
                onChangeText={setColor}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Vehicle nickname</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder="Name or nickname"
                placeholderTextColor={COLORS.textMuted}
                value={nickname}
                onChangeText={setNickname}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Hex color code</Text>
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

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity 
          activeOpacity={0.8} 
          style={[styles.primaryButton, (loading || scanning) && styles.disabled]} 
          onPress={handleSubmit}
          disabled={loading || scanning}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.textInverse} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>Add vehicle</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  cameraScreen: {
    backgroundColor: '#050505',
    flex: 1,
  },
  cameraHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
  },
  cameraHeaderButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.round,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cameraTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '800',
  },
  cameraBody: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  cameraGuide: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  cardCameraFrame: {
    aspectRatio: 3 / 2,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    width: '100%',
  },
  frameBorder: {
    ...StyleSheet.absoluteFill,
    borderColor: 'rgba(212,175,55,0.38)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  frameCorner: {
    borderColor: COLORS.gold,
    height: 32,
    position: 'absolute',
    width: 32,
  },
  frameCornerTopLeft: {
    borderLeftWidth: 4,
    borderTopWidth: 4,
    left: 0,
    top: 0,
  },
  frameCornerTopRight: {
    borderRightWidth: 4,
    borderTopWidth: 4,
    right: 0,
    top: 0,
  },
  frameCornerBottomLeft: {
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    bottom: 0,
    left: 0,
  },
  frameCornerBottomRight: {
    borderBottomWidth: 4,
    borderRightWidth: 4,
    bottom: 0,
    right: 0,
  },
  cameraTips: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  cameraTipText: {
    color: COLORS.textSecondary,
    flexShrink: 1,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  captureControls: {
    alignItems: 'center',
    paddingBottom: SPACING.xl,
  },
  captureButtonOuter: {
    alignItems: 'center',
    borderColor: COLORS.textPrimary,
    borderRadius: 40,
    borderWidth: 3,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  captureButtonInner: {
    backgroundColor: COLORS.gold,
    borderRadius: 31,
    height: 62,
    width: 62,
  },
  captureLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginTop: SPACING.sm,
  },
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  scroll: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
    gap: SPACING.lg,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderColor: 'rgba(212,175,55,0.3)',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
    borderStyle: 'dashed',
  },
  scanButtonText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  formCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
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
    height: 48,
  },
  input: {
    flex: 1,
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
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
});
