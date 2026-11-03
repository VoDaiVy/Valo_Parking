import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';

export function LanguageToggle({ inline = false }: { inline?: boolean }) {
  const { language, toggleLanguage, t } = useLanguage();
  return <Pressable accessibilityRole="switch" accessibilityLabel={t('Switch language')} accessibilityState={{ checked: language === 'vi' }} hitSlop={inline ? { top: 7, bottom: 7 } : undefined} onPress={toggleLanguage} style={({ pressed }) => [styles.toggle, inline && styles.inlineToggle, pressed && styles.pressed]}><Ionicons name="language-outline" size={12} color={COLORS.gold} /><Text style={styles.label}>{language === 'en' ? 'EN' : 'VI'}</Text></Pressable>;
}

const styles = StyleSheet.create({
  toggle: { alignItems: 'center', backgroundColor: 'rgba(10,11,13,0.9)', borderColor: 'rgba(226,186,75,0.45)', borderRadius: RADIUS.round, borderWidth: 1, flexDirection: 'row', gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 9, position: 'absolute', right: 118, top: 52, zIndex: 20 },
  inlineToggle: { position: 'relative', right: undefined, top: undefined, zIndex: 1, minHeight: 30, minWidth: 52, paddingHorizontal: SPACING.sm, backgroundColor: `${COLORS.gold}14`, borderColor: `${COLORS.gold}44` },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  label: { color: COLORS.gold, fontSize: FONT_SIZES.xs, fontWeight: '700' },
});
