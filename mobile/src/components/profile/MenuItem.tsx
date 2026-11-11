import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, CONTROL, RADIUS, SPACE, SPACING } from '../../constants/theme';
import { typography } from '@/theme';

export function MenuItem({
  icon,
  label,
  sublabel,
  iconColor,
  iconBg,
  onPress,
  showArrow = true,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  iconColor: string;
  iconBg: string;
  onPress?: () => void;
  showArrow?: boolean;
  danger?: boolean;
}) {
  const { t: translateUi } = useLanguage();
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label} onPress={onPress} activeOpacity={0.8} style={styles.menuItem}>
      <View style={[styles.menuIconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={CONTROL.iconSize} color={iconColor} />
      </View>
      <View style={styles.menuTextWrap}>
        <Text style={[styles.menuLabel, danger && { color: COLORS.error }]}>{translateUi(label)}</Text>
        {sublabel && <Text style={styles.menuSublabel}>{translateUi(sublabel)}</Text>}
      </View>
      {showArrow && (
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
    minHeight: CONTROL.minHeight,
  },
  menuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTextWrap: { flex: 1, minWidth: 0 },
  menuLabel: { ...typography.body1, color: COLORS.textPrimary, fontWeight: '500' },
  menuSublabel: { ...typography.body2, color: COLORS.textSecondary, marginTop: SPACE[4] },
});
