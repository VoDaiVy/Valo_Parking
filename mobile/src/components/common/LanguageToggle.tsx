import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COLORS, RADIUS } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();
  return <Pressable accessibilityRole="switch" accessibilityLabel="Switch language" accessibilityState={{ checked: language === 'vi' }} onPress={toggleLanguage} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}><Ionicons name="language-outline" size={14} color={COLORS.gold} /><Text style={styles.label}>{language === 'en' ? 'EN' : 'VI'}</Text></Pressable>;
}

const styles = StyleSheet.create({
  toggle: { alignItems: 'center', backgroundColor: 'rgba(10,11,13,0.9)', borderColor: 'rgba(226,186,75,0.45)', borderRadius: RADIUS.round, borderWidth: 1, flexDirection: 'row', gap: 4, minHeight: 30, paddingHorizontal: 9, position: 'absolute', right: 14, top: 52, zIndex: 20 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  label: { color: COLORS.gold, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
});
