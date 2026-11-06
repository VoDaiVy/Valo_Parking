import { AnimatedBackground, BrandHeader, AuthCard, PrimaryButton, BRAND, authStyles as styles } from '@/components/auth/AuthVisuals';
import { GoogleIcon } from '@/components/auth/GoogleIcon';
import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { typography } from '@/theme';
import { useAppAlert } from '@/contexts/AppAlertContext';
import { useAuth } from '@/hooks/useAuth';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import type { AuthStackParamList } from '@/navigation/types';
import { authService } from '@/services/api/auth';
import type { RegisterRequest } from '@/types/api';
import { isValidEmail, isValidPassword } from '@/utils/validation';



type AuthMode = 'signin' | 'signup';
type Props = NativeStackScreenProps<AuthStackParamList, 'Login' | 'Register'>;






function SegmentedControl({
  mode,
  onChange,
}: {
  mode: AuthMode;
  onChange: (mode: AuthMode) => void;
}) {
  const { t: translateUi } = useLanguage();
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
      <SegmentButton active={mode === 'signin'} label={translateUi("Sign In")} onPress={() => onChange('signin')} />
      <SegmentButton active={mode === 'signup'} label={translateUi("Sign Up")} onPress={() => onChange('signup')} />
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
  const { t: translateUi } = useLanguage();
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
        <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{translateUi(label)}</Text>
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
  const { t: translateUi } = useLanguage();
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
      <Animated.Text style={[styles.inputLabel, { color: labelColor }]}>{translateUi(label)}</Animated.Text>
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
      {error ? <Text style={styles.inputErrorText}>{translateUi(error)}</Text> : null}
    </View>
  );
}

function ForgotPasswordLink({ onPress }: { onPress: () => void }) {
  const { t: translateUi } = useLanguage();
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
        <Text style={styles.forgotText}>{translateUi("Forgot password?")}</Text>
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
  const { t: translateUi } = useLanguage();
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
            <Text style={styles.googleBtnText}>{translateUi("Continue with Google")}</Text>
          </>
        )}
      </Pressable>
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
  const { t: translateUi } = useLanguage();
  return (
    <>
      <Text style={styles.cardTitle}>{translateUi("Welcome back")}</Text>
      <Text style={styles.cardSub}>{translateUi("Access bookings, wallet, and your VALO parking flow.")}</Text>

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
        label={translateUi("Password")}
        loading={loading}
        password
        placeholder={translateUi("Enter password")}
        returnKeyType="done"
        secureTextEntry={passwordHidden}
        value={password}
        onChangeText={onPasswordChange}
        onSubmitEditing={onSubmit}
        onTogglePassword={onTogglePassword}
      />

      <ForgotPasswordLink onPress={onForgotPassword} />

      <PrimaryButton loading={loading} title={translateUi("Sign In")} onPress={onSubmit} />

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{translateUi("or continue with")}</Text>
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
  const { t: translateUi } = useLanguage();
  return (
    <>
      <Text style={styles.cardTitle}>{translateUi("Create account")}</Text>
      <Text style={styles.cardSub}>{translateUi("Start booking faster with a polished VALO profile.")}</Text>

      <AuthTextInput
        autoCapitalize="words"
        icon="person-outline"
        label={translateUi("Full Name")}
        loading={loading}
        placeholder={translateUi("Your full name")}
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
        label={translateUi("Phone")}
        loading={loading}
        placeholder={translateUi("Phone number")}
        returnKeyType="next"
        value={phone}
        onChangeText={onPhoneChange}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="lock-closed-outline"
        label={translateUi("Password")}
        loading={loading}
        password
        placeholder={translateUi("At least 8 characters")}
        returnKeyType="next"
        secureTextEntry={passwordHidden}
        value={password}
        onChangeText={onPasswordChange}
        onTogglePassword={onTogglePassword}
      />
      <AuthTextInput
        autoCapitalize="none"
        icon="shield-checkmark-outline"
        label={translateUi("Confirm Password")}
        loading={loading}
        password
        placeholder={translateUi("Re-enter password")}
        returnKeyType="done"
        secureTextEntry={confirmPasswordHidden}
        value={confirmPassword}
        onChangeText={onConfirmPasswordChange}
        onSubmitEditing={onSubmit}
        onTogglePassword={onToggleConfirmPassword}
      />

      <ErrorBanner message={translateUi(error)} />

      <PrimaryButton loading={loading} title={translateUi("Create Account")} onPress={onSubmit} />
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
  const { t: translateUi } = useLanguage();
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

      navigation.navigate('VerifyOTP', { email: normalizedEmail, purpose: 'register' });
    } catch (submitError) {
      setRegisterError(submitError instanceof Error ? submitError.message : 'Registration failed.');
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[BRAND.background, COLORS.surface, COLORS.goldTint]}
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
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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

          <Text style={styles.footer}>{translateUi("2026 VALO Parking - All rights reserved")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
