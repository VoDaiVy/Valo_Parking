import { Platform, TextStyle } from 'react-native';
import { FONT_SIZES } from '@/constants/theme';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: undefined,
});

export const typography = {
  h1: {
    fontFamily,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.5,
  } satisfies TextStyle,
  h2: {
    fontFamily,
    fontSize: FONT_SIZES.xxl,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.25,
  } satisfies TextStyle,
  h3: {
    fontFamily,
    fontSize: FONT_SIZES.xl,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 0,
  } satisfies TextStyle,
  body1: {
    fontFamily,
    fontSize: FONT_SIZES.md,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: 0,
  } satisfies TextStyle,
  body2: {
    fontFamily,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  } satisfies TextStyle,
  caption: {
    fontFamily,
    fontSize: FONT_SIZES.xs,
    lineHeight: 16,
    fontWeight: '400',
    letterSpacing: 0,
  } satisfies TextStyle,
  button: {
    fontFamily,
    fontSize: FONT_SIZES.md,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: 0,
  } satisfies TextStyle,
};
