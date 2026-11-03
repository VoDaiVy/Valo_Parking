import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';

export type BookingModalVariant = 'success' | 'error' | 'warning' | 'info';

interface BookingActionModalProps {
  visible: boolean;
  variant: BookingModalVariant;
  title: string;
  message?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  children?: ReactNode;
  onPrimary: () => void;
  onSecondary?: () => void;
  onClose: () => void;
}

const VARIANT_CONFIG: Record<BookingModalVariant, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  success: { icon: 'checkmark-circle', color: COLORS.success },
  error: { icon: 'close-circle', color: COLORS.error },
  warning: { icon: 'alert-circle', color: COLORS.warning },
  info: { icon: 'information-circle', color: COLORS.staffBlue },
};

export const BookingActionModal = ({
  visible,
  variant,
  title,
  message,
  primaryLabel,
  secondaryLabel,
  destructive = false,
  loading = false,
  children,
  onPrimary,
  onSecondary,
  onClose,
}: BookingActionModalProps) => {
  const { t: translateUi } = useLanguage();
  const config = VARIANT_CONFIG[variant];

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.iconGlow, { backgroundColor: `${config.color}18` }]}>
            <Ionicons name={config.icon} size={76} color={config.color} />
          </View>
          <Text style={[styles.title, { color: destructive ? COLORS.error : config.color }]}>{translateUi(title)}</Text>
          {message ? <Text style={styles.message}>{translateUi(message)}</Text> : null}
          {children}

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              style={[styles.button, destructive ? styles.dangerButton : variant === 'success' ? styles.successButton : styles.primaryButton]}
              onPress={onPrimary}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.textInverse} size="small" />
              ) : (
                <Text style={styles.primaryText}>{translateUi(primaryLabel)}</Text>
              )}
            </TouchableOpacity>
            {secondaryLabel ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={loading}
                style={[styles.button, styles.secondaryButton]}
                onPress={onSecondary ?? onClose}
              >
                <Text style={styles.secondaryText}>{translateUi(secondaryLabel)}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  overlay: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    maxWidth: 440,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
    width: '100%',
  },
  iconGlow: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    height: 92,
    justifyContent: 'center',
    marginBottom: SPACING.md,
    width: 92,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    lineHeight: 24,
    marginBottom: SPACING.xl,
    textAlign: 'center',
  },
  actions: { gap: SPACING.sm, width: '100%' },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 50,
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
  },
  primaryButton: { backgroundColor: COLORS.gold },
  successButton: { backgroundColor: COLORS.success },
  dangerButton: { backgroundColor: COLORS.error },
  primaryText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  secondaryButton: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  secondaryText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
