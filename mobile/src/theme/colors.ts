import { COLORS, NEUTRALS } from '@/constants/theme';

export const palette = {
  primary: {
    50: COLORS.goldTint,
    100: '#3C3219',
    500: COLORS.gold,
    600: COLORS.goldLight,
    700: COLORS.goldDark,
    pressed: COLORS.goldPressed,
  },
  secondary: {
    50: COLORS.infoTint,
    100: '#19344C',
    500: COLORS.staffBlue,
    600: '#8BC9FF',
  },
  success: { light: COLORS.successTint, main: COLORS.success, dark: '#359A5B' },
  warning: { light: COLORS.warningTint, main: COLORS.warning, dark: '#E3A52B' },
  error: { light: COLORS.errorTint, main: COLORS.error, dark: '#DF4048' },
  info: { light: COLORS.infoTint, main: COLORS.info, dark: '#2F7FD8' },
  // Preserve legacy neutral aliases; use neutralScale for the ordered ramp.
  neutralScale: NEUTRALS,
  neutral: {
    white: COLORS.textPrimary,
    50: COLORS.background,
    100: COLORS.surface,
    200: COLORS.border,
    400: COLORS.textMuted,
    600: COLORS.textSecondary,
    800: '#292C31',
    900: COLORS.textInverse,
    black: '#090A0C',
  },
};

const darkSurfaces = {
  background: COLORS.background,
  surface: COLORS.surface,
  surfaceElevated: COLORS.surfaceElevated,
  text: {
    primary: COLORS.textPrimary,
    secondary: COLORS.textSecondary,
    muted: COLORS.textMuted,
    inverse: COLORS.textInverse,
  },
  border: COLORS.border,
};

export const colors = {
  ...palette,
  // `light` is a compatibility alias used by existing dark UI components.
  light: darkSurfaces,
  dark: darkSurfaces,
};
