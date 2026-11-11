import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

import { borderRadius, colors, shadows, spacing } from '@/theme';

export interface CardProps extends ViewProps {
  elevation?: 'none' | 'sm' | 'md';
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

export const Card = ({ elevation = 'sm', padding = spacing.lg, style, ...props }: CardProps) => (
  <View
    style={[
      styles.base,
      elevation !== 'none' && shadows[elevation],
      { padding },
      style,
    ]}
    {...props}
  />
);

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.light.surface,
    borderRadius: borderRadius.lg,
    minWidth: 0,
  },
});
