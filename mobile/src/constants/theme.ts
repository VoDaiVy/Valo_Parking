// Shared neutral ramp; numeric keys progress from darkest to lightest.
export const NEUTRALS = {
  0: '#0B0C0E',
  100: '#111315',
  200: '#15171A',
  300: '#1D2024',
  400: '#292D32',
  500: '#383D44',
  600: '#626A75',
  700: '#A9ADB4',
  800: '#D6D9DE',
  900: '#F4F4F0',
} as const;

export const COLORS = {
  // Backgrounds
  background: NEUTRALS[0],
  surface: NEUTRALS[200],
  surfaceElevated: NEUTRALS[300],

  // Brand Gold
  gold: '#E2BA4B',
  goldLight: '#F2D47A',
  goldDark: '#A77E20',
  goldPressed: '#D2AA3C',
  goldTint: '#2A2518',
  staffBlue: '#60B4FF',

  // Text
  textPrimary: NEUTRALS[900],
  textSecondary: NEUTRALS[700],
  textMuted: '#969DA7',
  textInverse: '#111214',

  // Borders
  border: NEUTRALS[400],
  borderLight: NEUTRALS[500],

  // Status
  error: '#FF7078',
  errorTint: '#3A1C20',
  success: '#66D08A',
  successTint: '#173526',
  warning: '#FFBC66',
  warningTint: '#3A2D13',
  info: '#60B4FF',
  infoTint: '#142331',

  // Gradient stops (used with LinearGradient)
  gradientGold: ['#F2D47A', '#E2BA4B', '#B88A24'] as const,
  gradientDark: ['#1D2024', '#0B0C0E'] as const,
  gradientStaff: ['#60B4FF', '#2F7FD8'] as const,
};

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  hero: 40,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Keep legacy SPACING values stable; use this scale for incremental migration.
export const SPACE = { 0: 0, 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32, 48: 48, 64: 64 } as const;

export const CONTROL = { minTouchSize: 44, minHeight: 48, iconSize: 20 } as const;
export const MOTION = { fast: 120, normal: 180, pressedScale: 0.98 } as const;
