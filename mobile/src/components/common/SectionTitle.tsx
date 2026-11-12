import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import { COLORS } from '@/constants/theme';
import { typography } from '@/theme';
import { useLanguage } from '@/contexts/LanguageContext';

export interface SectionTitleProps {
  children: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function SectionTitle({ children, color = COLORS.textSecondary, style }: SectionTitleProps) {
  const { t } = useLanguage();
  return <Text accessibilityRole="header" style={[styles.title, { color }, style]}>{t(children)}</Text>;
}

const styles = StyleSheet.create({
  title: {
    ...typography.body2,
    fontWeight: '600',
  },
});
