import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useAuth } from '@/hooks/useAuth';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import type { RegisterRequest } from '@/types/api';
import { isValidEmail, isValidPassword } from '@/utils/validation';


const LogoImg = require('../../../assets/logo.png') as number;

type AuthMode = 'signin' | 'signup';
type Props = NativeStackScreenProps<AuthStackParamList, 'Login' | 'Register'>;

const BUTTON_SHINE_WIDTH = 86;

function GoogleIcon() {
  return (
    <View style={googleIconStyles.wrap}>
      <View style={[googleIconStyles.quad, { backgroundColor: '#4285F4' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#34A853' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#FBBC05' }]} />
      <View style={[googleIconStyles.quad, { backgroundColor: '#EA4335' }]} />
    </View>
  );
}

function useLoopingAnimation(duration: number, delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          duration,
          easing: Easing.inOut(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration,
          easing: Easing.inOut(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return progress;
}

function AnimatedBackground() {
  const glowOne = useLoopingAnimation(6200);
  const glowTwo = useLoopingAnimation(7800, 450);
  const glowThree = useLoopingAnimation(8600, 900);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.cornerGlow,
          {
            opacity: glowOne.interpolate({
              inputRange: [0, 1],
              outputRange: [0.055, 0.085],
            }),
            transform: [
              {
                scale: glowOne.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.08],
                }),
              },
              {
                translateX: glowOne.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -8],
                }),
              },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.bottomGlow,
          {
            opacity: glowTwo.interpolate({
              inputRange: [0, 1],
              outputRange: [0.04, 0.07],
            }),
            transform: [
              {
                scale: glowTwo.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.06],
                }),
              },
              {
                translateY: glowTwo.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -12],
                }),
              },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.logoHaloBack,
          {
            opacity: glowThree.interpolate({
              inputRange: [0, 1],
              outputRange: [0.04, 0.075],
            }),
            transform: [
              {
                scale: glowThree.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1.05],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function BrandHeader() {
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useLoopingAnimation(5600, 250);

  useEffect(() => {
    Animated.timing(entrance, {
      duration: 640,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.hero,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.logoAura}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.logoPulseRing,
            {
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.28, 0.58],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1.12],
                  }),
                },
              ],
            },
          ]}
        />
        <View style={styles.logoGlow}>
          <Image resizeMode="contain" source={LogoImg} style={styles.logoImg} />
        </View>
      </View>
      <Text style={styles.brandName}>VALO</Text>
      <Text style={styles.brandSub}>PARKING</Text>
      <View style={styles.badge}>
        <Ionicons name="flash" size={11} color={BRAND.gold} />
        <Text style={styles.badgeText}>Smart Parking Platform</Text>
      </View>
    </Animated.View>
  );
}

function SegmentedControl({
  mode,
  onChange,
}: {
  mode: AuthMode;
  onChange: (mode: AuthMode) => void;
}) {
  const progress = useRef(new Animated.Value(mode === 'signin' ? 0 : 1)).current;
  const [width, setWidth] = useState(0);
  const segmentWidth = width / 2;

  useEffect(() => {
    Animated.spring(progress, {
      damping: 18,
      mass: 0.75,
      stiffness: 180,
      toValue: mode === 'signin' ? 0 : 1,
      useNativeDriver: true,
    }).start();
  }, [mode, progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, segmentWidth || 0],
  });

  return (
    <View
      style={styles.segmented}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentIndicator,
            {
              transform: [{ translateX }],
              width: segmentWidth,
            },
          ]}
        />
      ) : null}
      <SegmentButton active={mode === 'signin'} label="Sign In" onPress={() => onChange('signin')} />
      <SegmentButton active={mode === 'signup'} label="Sign Up" onPress={() => onChange('signup')} />
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animatePress = (toValue: number) => {
    Animated.spring(scale, {
      damping: 14,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.segmentButtonWrap,
        {
          transform: [{ scale }],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={styles.segmentButton}
        onPress={onPress}
        onPressIn={() => animatePress(0.97)}
        onPressOut={() => animatePress(1)}
      >
        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function StaggeredReveal({
  children,
  delay,
}: {
  children: ReactNode;
  delay: number;
}) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      delay,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [delay, entrance]);

  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function PasswordToggle({
  hidden,
  disabled,
  onPress,
}: {
  hidden?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animatePress = (toValue: number) => {
    Animated.spring(scale, {
      damping: 13,
      mass: 0.5,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={disabled}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.fieldIconRight}
        onPress={onPress}
        onPressIn={() => animatePress(0.9)}
        onPressOut={() => animatePress(1)}
      >
        <Ionicons
          name={hidden ? 'eye-off-outline' : 'eye-outline'}
          size={18}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

function AuthTextInput({
  label,
  icon,
  error,
  loading,
  disabled,
  password,
  secureTextEntry,
  onTogglePassword,
  ...props
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
  loading?: boolean;
  disabled?: boolean;
  password?: boolean;
  secureTextEntry?: boolean;
  onTogglePassword?: () => void;
} & React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  const focusProgress = useRef(new Animated.Value(0)).current;
  const isDisabled = disabled || loading;

  useEffect(() => {
    Animated.timing(focusProgress, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: focused ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [focused, focusProgress]);

  const borderColor = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [BRAND.border, 'rgba(244,197,66,0.68)'],
  });
  const backgroundColor = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.045)', 'rgba(244,197,66,0.075)'],
  });
  const labelColor = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [COLORS.textSecondary, COLORS.textPrimary],
  });
  const glowOpacity = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.24],
  });

  return (
    <View style={styles.inputBlock}>
      <Animated.Text style={[styles.inputLabel, { color: labelColor }]}>{label}</Animated.Text>
      <Animated.View pointerEvents="none" style={[styles.fieldGlow, { opacity: glowOpacity }]} />
      <Animated.View
        style={[
          styles.fieldWrap,
          { backgroundColor, borderColor },
          error && styles.fieldError,
          isDisabled && styles.fieldDisabled,
        ]}
      >
        <View style={styles.fieldIconLeft}>
          <Ionicons
            name={icon}
            size={18}
            color={focused ? BRAND.gold : COLORS.textMuted}
          />
        </View>
        <TextInput
          accessibilityLabel={props.accessibilityLabel || label}
          editable={!isDisabled}
          placeholderTextColor={COLORS.textMuted}
          selectionColor={BRAND.gold}
          secureTextEntry={secureTextEntry}
          style={styles.fieldInput}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          {...props}
        />
        {password ? (
          <PasswordToggle
            disabled={isDisabled}
            hidden={secureTextEntry}
            onPress={onTogglePassword}
          />
        ) : null}
      </Animated.View>
      {error ? <Text style={styles.inputErrorText}>{error}</Text> : null}
    </View>
  );
}

function ForgotPasswordLink({ onPress }: { onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;

  const animatePress = (toValue: number) => {
    Animated.spring(scale, {
      damping: 13,
      mass: 0.5,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.forgotRow, { transform: [{ scale }] }]}>
      <Pressable
        hitSlop={{ top: 8, bottom: 8, left: 10, right: 10 }}
        style={({ pressed }) => [styles.forgotPress, pressed && styles.pressed]}
        onPress={onPress}
        onPressIn={() => animatePress(0.96)}
        onPressOut={() => animatePress(1)}
      >
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>
    </Animated.View>
  );
}

function PrimaryButton({
  title,
  loading,
  disabled,
  onPress,
}: {
  title: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const isDisabled = disabled || loading;
  const press = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    shine.setValue(0);
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(shine, {
        duration: 900,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [shine, title]);

  const animatePress = (toValue: number) => {
    Animated.spring(press, {
      damping: 14,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.98],
  });
  const arrowTranslate = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 4],
  });
  const shineTranslate = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-BUTTON_SHINE_WIDTH, 360],
  });

  return (
    <Animated.View
      style={[
        styles.primaryBtn,
        isDisabled && styles.disabled,
        {
          transform: [{ scale }],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: isDisabled }}
        disabled={isDisabled}
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
      >
        <LinearGradient
          colors={[BRAND.goldLight, BRAND.gold, BRAND.goldDark]}
          end={{ x: 1, y: 0 }}
          start={{ x: 0, y: 0 }}
          style={styles.primaryBtnGrad}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.buttonShine,
              {
                transform: [{ translateX: shineTranslate }, { rotate: '18deg' }],
              },
            ]}
          />
          {loading ? (
            <ActivityIndicator color={COLORS.textInverse} size="small" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>{title}</Text>
              <Animated.View style={{ transform: [{ translateX: arrowTranslate }] }}>
                <Ionicons name="arrow-forward" size={18} color={COLORS.textInverse} />
              </Animated.View>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function GoogleAuthButton({
  enabled,
  loading,
  onPress,
}: {
  enabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = !enabled || loading;

  const animatePress = (toValue: number) => {
    Animated.spring(scale, {
      damping: 14,
      mass: 0.55,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.googleBtnWrap,
        isDisabled && styles.disabled,
        {
          transform: [{ scale }],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: loading, disabled: isDisabled }}
        disabled={isDisabled}
        style={({ pressed }) => [styles.googleBtn, pressed && styles.googleBtnPressed]}
        onPress={onPress}
        onPressIn={() => animatePress(0.985)}
        onPressOut={() => animatePress(1)}
      >
        {loading ? (
          <ActivityIndicator color="#444" size="small" />
        ) : (
          <>
            <GoogleIcon />
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

function AuthCard({ children }: { children: ReactNode }) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      delay: 180,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={[BRAND.gold, 'rgba(244,197,66,0.06)', 'transparent']}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={styles.cardTopLine}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.045)', 'rgba(255,255,255,0)', 'rgba(244,197,66,0.035)']}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.cardInnerGlow} />
      {children}
    </Animated.View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;

    opacity.setValue(0);
    shake.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(shake, {
          duration: 45,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(shake, {
          duration: 45,
          toValue: -1,
          useNativeDriver: true,
        }),
        Animated.timing(shake, {
          duration: 45,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [message, opacity, shake]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.formError,
        {
          opacity,
          transform: [
            {
              translateX: shake.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: [-5, 0, 5],
              }),
            },
          ],
        },
      ]}
    >
      <Ionicons name="warning-outline" size={15} color={COLORS.error} />
      <Text style={styles.formErrorText}>{message}</Text>
    </Animated.View>
  );
}

function SignInForm({
  email,
  password,
  passwordHidden,
  loading,
  googleLoading,
  googleEnabled,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onForgotPassword,
  onSubmit,
  onGooglePress,
}: {
  email: string;
  password: string;
  passwordHidden: boolean;
  loading: boolean;
  googleLoading: boolean;
  googleEnabled: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onForgotPassword: () => void;
  onSubmit: () => void;
  onGooglePress: () => void;
}) {
  return (
    <>
      <Text style={styles.cardTitle}>Welcome back</Text>
      <Text style={styles.cardSub}>Access bookings, wallet, and your VALO parking flow.</Text>

      <AuthTextInput
        autoCapitalize="none"
        icon="mail-outline"
        keyboardType="email-address"
        label="Email"
        loading={loading}
        placeholder="you@example.com"
        returnKeyType="next"
        value={email}
        onChangeText={onEmailChange}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="lock-closed-outline"
        label="Password"
        loading={loading}
        password
        placeholder="Enter password"
        returnKeyType="done"
        secureTextEntry={passwordHidden}
        value={password}
        onChangeText={onPasswordChange}
        onSubmitEditing={onSubmit}
        onTogglePassword={onTogglePassword}
      />

      <ForgotPasswordLink onPress={onForgotPassword} />

      <PrimaryButton loading={loading} title="Sign In" onPress={onSubmit} />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleAuthButton enabled={googleEnabled} loading={googleLoading} onPress={onGooglePress} />
    </>
  );
}

function SignUpForm({
  name,
  email,
  phone,
  password,
  confirmPassword,
  passwordHidden,
  confirmPasswordHidden,
  loading,
  error,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onTogglePassword,
  onToggleConfirmPassword,
  onSubmit,
}: {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  passwordHidden: boolean;
  confirmPasswordHidden: boolean;
  loading: boolean;
  error: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <Text style={styles.cardTitle}>Create account</Text>
      <Text style={styles.cardSub}>Start booking faster with a polished VALO profile.</Text>

      <AuthTextInput
        autoCapitalize="words"
        icon="person-outline"
        label="Full Name"
        loading={loading}
        placeholder="Your full name"
        returnKeyType="next"
        value={name}
        onChangeText={onNameChange}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="mail-outline"
        keyboardType="email-address"
        label="Email"
        loading={loading}
        placeholder="you@example.com"
        returnKeyType="next"
        value={email}
        onChangeText={onEmailChange}
      />
      <AuthTextInput
        icon="call-outline"
        keyboardType="phone-pad"
        label="Phone"
        loading={loading}
        placeholder="Phone number"
        returnKeyType="next"
        value={phone}
        onChangeText={onPhoneChange}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="lock-closed-outline"
        label="Password"
        loading={loading}
        password
        placeholder="At least 8 characters"
        returnKeyType="next"
        secureTextEntry={passwordHidden}
        value={password}
        onChangeText={onPasswordChange}
        onTogglePassword={onTogglePassword}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="shield-checkmark-outline"
        label="Confirm Password"
        loading={loading}
        password
        placeholder="Re-enter password"
        returnKeyType="done"
        secureTextEntry={confirmPasswordHidden}
        value={confirmPassword}
        onChangeText={onConfirmPasswordChange}
        onSubmitEditing={onSubmit}
        onTogglePassword={onToggleConfirmPassword}
      />

      <ErrorBanner message={error} />

      <PrimaryButton loading={loading} title="Create Account" onPress={onSubmit} />
    </>
  );
}

function AnimatedForm({
  mode,
  children,
}: {
  mode: AuthMode;
  children: ReactNode;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const previousMode = useRef(mode);

  useEffect(() => {
    const direction = previousMode.current === 'signin' && mode === 'signup' ? 1 : -1;
    previousMode.current = mode;

    opacity.setValue(0);
    translateX.setValue(direction * 18);
    translateY.setValue(6);
    Animated.parallel([
      Animated.timing(opacity, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mode, opacity, translateX, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }, { translateY }] }}>
      {children}
    </Animated.View>
  );
}

const createUsername = (name: string, email: string) => {
  const source = name.trim() || email.split('@')[0] || 'valo_user';
  const base = source
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

  return (base.length >= 3 ? base : `${base}_user`).slice(0, 30);
};

export default function AuthScreen({ navigation, route }: Props) {
  const { login } = useAuth();
  const { alert } = useAppAlert();
  const [mode, setMode] = useState<AuthMode>(route.name === 'Register' ? 'signup' : 'signin');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordHidden, setLoginPasswordHidden] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const { loading: googleLoading, enabled: googleEnabled, signIn: promptGoogleLogin } = useGoogleSignIn();

  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [registerPasswordHidden, setRegisterPasswordHidden] = useState(true);
  const [registerConfirmPasswordHidden, setRegisterConfirmPasswordHidden] = useState(true);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const handleLogin = async () => {
    const trimEmail = loginEmail.trim();
    const trimPass = loginPassword.trim();

    if (!trimEmail || !trimPass) {
      alert('Missing information', 'Please enter your email and password.');
      return;
    }

    setLoginLoading(true);
    try {
      await login({ email: trimEmail, password: trimPass });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      alert('Sign-in failed', message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegister = async () => {
    const normalizedName = registerName.trim();
    const normalizedEmail = registerEmail.trim().toLowerCase();
    const normalizedPhone = registerPhone.trim();

    if (!normalizedName) {
      setRegisterError('Please enter your full name.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setRegisterError('Please enter a valid email address.');
      return;
    }

    if (!isValidPassword(registerPassword)) {
      setRegisterError('Password must be at least 8 characters.');
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      setRegisterError('Passwords do not match.');
      return;
    }

    setRegisterLoading(true);
    setRegisterError('');

    try {
      const payload: RegisterRequest & { confirmPassword: string } = {
        username: createUsername(normalizedName, normalizedEmail),
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone || undefined,
        password: registerPassword,
        confirmPassword: registerConfirmPassword,
        role: 'customer',
      };

      await authService.register(payload);

      alert('Account created', 'Please verify your email to continue.');
      navigation.navigate('VerifyOTP', { email: normalizedEmail, purpose: 'register' });
    } catch (submitError) {
      setRegisterError(submitError instanceof Error ? submitError.message : 'Registration failed.');
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND.background} />
      <LinearGradient
        colors={[BRAND.background, '#11110F', '#151209']}
        locations={[0, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedBackground />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BrandHeader />

          <AuthCard>
            <StaggeredReveal delay={360}>
              <SegmentedControl mode={mode} onChange={setMode} />
            </StaggeredReveal>
            <StaggeredReveal delay={470}>
              <AnimatedForm mode={mode}>
                {mode === 'signin' ? (
                  <SignInForm
                    email={loginEmail}
                    googleEnabled={googleEnabled}
                    googleLoading={googleLoading}
                    loading={loginLoading}
                    password={loginPassword}
                    passwordHidden={loginPasswordHidden}
                    onEmailChange={setLoginEmail}
                    onForgotPassword={() => navigation.navigate('ForgotPassword')}
                    onGooglePress={promptGoogleLogin}
                    onPasswordChange={setLoginPassword}
                    onSubmit={handleLogin}
                    onTogglePassword={() => setLoginPasswordHidden((value) => !value)}
                  />
                ) : (
                  <SignUpForm
                    confirmPassword={registerConfirmPassword}
                    confirmPasswordHidden={registerConfirmPasswordHidden}
                    email={registerEmail}
                    error={registerError}
                    loading={registerLoading}
                    name={registerName}
                    password={registerPassword}
                    passwordHidden={registerPasswordHidden}
                    phone={registerPhone}
                    onConfirmPasswordChange={setRegisterConfirmPassword}
                    onEmailChange={setRegisterEmail}
                    onNameChange={setRegisterName}
                    onPasswordChange={setRegisterPassword}
                    onPhoneChange={setRegisterPhone}
                    onSubmit={handleRegister}
                    onToggleConfirmPassword={() =>
                      setRegisterConfirmPasswordHidden((value) => !value)
                    }
                    onTogglePassword={() => setRegisterPasswordHidden((value) => !value)}
                  />
                )}
              </AnimatedForm>
            </StaggeredReveal>
          </AuthCard>

          <Text style={styles.footer}>2026 VALO Parking - All rights reserved</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const BRAND = {
  background: '#0F0F0D',
  card: '#17181D',
  gold: '#F4C542',
  goldLight: '#FFE089',
  goldDark: '#D4A017',
  border: 'rgba(255,255,255,0.08)',
};

const googleIconStyles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: 20,
    overflow: 'hidden',
    width: 20,
  },
  quad: {
    height: 10,
    width: 10,
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BRAND.background,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
  },
  logoHaloBack: {
    backgroundColor: BRAND.gold,
    borderRadius: 120,
    height: 240,
    left: '50%',
    marginLeft: -120,
    position: 'absolute',
    top: 72,
    width: 240,
  },
  cornerGlow: {
    backgroundColor: BRAND.gold,
    borderRadius: 130,
    height: 260,
    opacity: 0.06,
    position: 'absolute',
    right: -90,
    top: -70,
    width: 260,
  },
  bottomGlow: {
    backgroundColor: BRAND.goldDark,
    borderRadius: 150,
    bottom: -150,
    height: 300,
    left: -120,
    opacity: 0.045,
    position: 'absolute',
    width: 300,
  },
  hero: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  logoAura: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.05)',
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    width: 96,
  },
  logoPulseRing: {
    borderColor: 'rgba(244,197,66,0.55)',
    borderRadius: 48,
    borderWidth: 1,
    height: 96,
    position: 'absolute',
    width: 96,
  },
  logoGlow: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.08)',
    borderColor: 'rgba(244,197,66,0.28)',
    borderRadius: 42,
    borderWidth: 1,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  logoImg: {
    height: 62,
    width: 62,
  },
  brandName: {
    color: BRAND.gold,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  brandSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: -2,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,197,66,0.1)',
    borderColor: 'rgba(244,197,66,0.22)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginTop: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    color: BRAND.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  card: {
    backgroundColor: BRAND.card,
    borderColor: BRAND.border,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
  },
  cardTopLine: {
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cardInnerGlow: {
    backgroundColor: 'rgba(244,197,66,0.04)',
    borderRadius: 140,
    height: 280,
    position: 'absolute',
    right: -170,
    top: -155,
    width: 280,
  },
  segmented: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: BRAND.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    marginBottom: SPACING.lg,
    padding: 4,
  },
  segmentIndicator: {
    backgroundColor: BRAND.gold,
    borderRadius: 14,
    bottom: 4,
    left: 4,
    position: 'absolute',
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    top: 4,
  },
  segmentButtonWrap: {
    flex: 1,
    zIndex: 1,
  },
  segmentButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  segmentLabelActive: {
    color: COLORS.textInverse,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '900',
    marginBottom: 5,
  },
  cardSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  inputBlock: {
    marginBottom: 12,
    position: 'relative',
  },
  inputLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
    marginBottom: 7,
  },
  fieldGlow: {
    backgroundColor: BRAND.gold,
    borderRadius: RADIUS.lg,
    bottom: 0,
    left: -2,
    position: 'absolute',
    right: -2,
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    top: 23,
  },
  fieldWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: SPACING.sm,
  },
  fieldFocused: {
    backgroundColor: 'rgba(244,197,66,0.075)',
    borderColor: 'rgba(244,197,66,0.65)',
  },
  fieldError: {
    borderColor: COLORS.error,
  },
  fieldDisabled: {
    opacity: 0.62,
  },
  fieldIconLeft: {
    alignItems: 'center',
    width: 34,
  },
  fieldIconRight: {
    alignItems: 'center',
    width: 34,
  },
  fieldInput: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    minHeight: 52,
    paddingVertical: 0,
  },
  inputErrorText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.xs,
    marginTop: 5,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginBottom: SPACING.md,
    marginTop: -2,
  },
  forgotPress: {
    borderRadius: RADIUS.round,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  forgotText: {
    color: BRAND.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  primaryBtn: {
    borderRadius: RADIUS.lg,
    marginTop: 2,
    overflow: 'hidden',
    shadowColor: BRAND.gold,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
  },
  primaryPressed: {
    transform: [{ scale: 0.985 }],
  },
  primaryBtnGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 54,
    overflow: 'hidden',
  },
  buttonShine: {
    backgroundColor: 'rgba(255,255,255,0.32)',
    bottom: -20,
    position: 'absolute',
    top: -20,
    width: BUTTON_SHINE_WIDTH,
  },
  primaryBtnText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '900',
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginVertical: SPACING.md,
  },
  dividerLine: {
    backgroundColor: BRAND.border,
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginHorizontal: SPACING.sm,
  },
  googleBtnWrap: {
    borderRadius: RADIUS.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  googleBtn: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E6E6',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 52,
  },
  googleBtnPressed: {
    backgroundColor: '#F8F8F8',
  },
  googleBtnText: {
    color: '#303134',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  formError: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderColor: 'rgba(255,77,77,0.22)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  formErrorText: {
    color: COLORS.error,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    textAlign: 'left',
  },
  footer: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: SPACING.lg,
    opacity: 0.5,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
});
