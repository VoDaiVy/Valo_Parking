import { Platform } from 'react-native';
import { COLORS } from '@/constants/theme';

export const shadows = {
  sm: Platform.select({
    ios: {
      shadowColor: COLORS.background,
      shadowOpacity: 0.12,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
    },
    android: { elevation: 1 },
    default: {},
  }),
  md: Platform.select({
    ios: {
      shadowColor: COLORS.background,
      shadowOpacity: 0.18,
      shadowOffset: { width: 0, height: 3 },
      shadowRadius: 8,
    },
    android: { elevation: 3 },
    default: {},
  }),
};
