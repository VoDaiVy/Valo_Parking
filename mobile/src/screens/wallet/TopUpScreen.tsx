import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { ErrorState, ScreenHeader, SectionTitle } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { WalletStackParamList } from '@/navigation/types';
import { walletService } from '@/services/api/wallet';
import { formatCurrency } from '@/utils/formatters';
import { isPolicyAcceptanceRequired } from '@/utils/policyErrors';
import { isValidTopUpAmount, TOP_UP_MIN_AMOUNT } from '@/utils/walletSubscription';

type Props = NativeStackScreenProps<WalletStackParamList, 'TopUp'>;

const QUICK_AMOUNTS = [50000, 100000, 200000, 500000];

export const TopUpScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [policyRequired, setPolicyRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [payment, setPayment] = useState<{
    orderCode: string | number;
    checkoutUrl: string;
    qrCode?: string;
    amount?: number;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [successCountdown, setSuccessCountdown] = useState<number | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up timers on unmount
  useEffect(() => () => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
  }, []);

  const triggerSuccessRedirect = () => {
    setSuccessCountdown(3);
    countdownTimerRef.current = setInterval(() => {
      setSuccessCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownTimerRef.current!);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    redirectTimerRef.current = setTimeout(() => {
      navigation.navigate('Wallet');
    }, 3000);
  };

  const handleSubmit = async () => {
    const numericAmount = Number(amount);

    if (!isValidTopUpAmount(numericAmount)) {
      setError(`The minimum top-up amount is ${formatCurrency(TOP_UP_MIN_AMOUNT)}.`);
      return;
    }

    setLoading(true);
    setError('');
    setPolicyRequired(false);
    try {
      const response = await walletService.createTopUp({ amount: numericAmount, paymentMethod: 'payos' });
      setPayment(response.data);
      setStatus('PENDING');
    } catch (submitError) {
      if (isPolicyAcceptanceRequired(submitError)) {
        setPolicyRequired(true);
        setError('You must accept the latest policy before adding funds.');
      } else {
        setError(submitError instanceof Error ? submitError.message : 'Top-up failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    if (!payment) return;
    try {
      const response = await walletService.getTopUpStatus(payment.orderCode);
      const newStatus = String(response.data?.status || 'PENDING');
      setStatus(newStatus);
      if (newStatus === 'COMPLETED' || newStatus === 'SUCCESS') {
        triggerSuccessRedirect();
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to check payment status.');
    }
  };

  const handleCancelPayment = async () => {
    if (!payment || cancelLoading) return;

    setCancelLoading(true);
    setError('');
    try {
      const response = await walletService.getTopUpStatus(payment.orderCode, true);
      const cancelledStatus = String(response.data?.status || 'CANCELLED');

      if (cancelledStatus === 'CANCELLED') {
        setPayment(null);
        setStatus('');
        return;
      }

      setStatus(cancelledStatus);
      if (cancelledStatus === 'COMPLETED' || cancelledStatus === 'SUCCESS') {
        triggerSuccessRedirect();
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel the transaction.');
    } finally {
      setCancelLoading(false);
    }
  };

  useEffect(() => {
    if (!payment || status !== 'PENDING') return;

    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt > 300000) {
        setStatus('TIMEOUT');
        clearInterval(interval);
        return;
      }
      void checkStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [payment, status]);

  // When status transitions to COMPLETED via polling, trigger redirect
  useEffect(() => {
    if (status === 'COMPLETED' || status === 'SUCCESS') {
      if (successCountdown === null) {
        triggerSuccessRedirect();
      }
    }
  }, [status]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={translateUi("Top up wallet")} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <SectionTitle>{translateUi("Amount")}</SectionTitle>
          <View style={styles.inputWrap}>
            <TextInput
              keyboardType="numeric"
              placeholder={translateUi("Enter amount")}
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
              value={amount}
              onChangeText={(value) => {
                setAmount(value.replace(/[^\d]/g, ''));
                setError('');
              }}
            />
            <Text style={styles.currency}>VND</Text>
          </View>
          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((value) => (
              <TouchableOpacity
                key={value}
                activeOpacity={0.75}
                style={[styles.quickChip, Number(amount) === value && styles.quickChipActive]}
                onPress={() => setAmount(String(value))}
              >
                <Text style={[styles.quickText, Number(amount) === value && styles.quickTextActive]}>
                  {formatCurrency(value)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {error && !payment ? <ErrorState message={translateUi(error)} /> : null}

        {policyRequired && !payment ? (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.outlineButton}
            onPress={() => navigation.getParent<NavigationProp<CustomerTabParamList>>()?.navigate('ProfileTab', { screen: 'Policies' })}
          >
            <Text style={styles.outlineButtonText}>{translateUi("Review and accept policy")}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity activeOpacity={0.85} disabled={loading} style={[styles.primaryButton, loading && styles.disabled]} onPress={handleSubmit}>
          {loading ? (
            <ActivityIndicator color={COLORS.textInverse} size="small" />
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color={COLORS.textInverse} />
              <Text style={styles.primaryButtonText}>{translateUi("Continue to payment")}</Text>
            </>
          )}
        </TouchableOpacity>

        {payment ? (
          <View style={styles.paymentCard}>
            <View style={styles.paymentHeader}>
              <View>
                <Text style={styles.paymentTitle}>PayOS</Text>
                <Text style={styles.paymentMeta}>{translateUi("Order ID:")}{" "}{payment.orderCode}</Text>
              </View>
              <Text style={styles.paymentAmount}>{formatCurrency(payment.amount || Number(amount))}</Text>
            </View>
            <View style={styles.statusRow}>
              <Ionicons name="sync-circle-outline" size={18} color={COLORS.gold} />
              <Text style={styles.statusText}>{translateUi("Status:")}{" "}{status}</Text>
            </View>
                        {payment.qrCode ? (
              <View style={styles.qrWrapper}>
                <QRCode
                  value={payment.qrCode}
                  size={220}
                  backgroundColor="white"
                  color="black"
                />
                <Text style={styles.qrHint}>{translateUi("Scan with your banking app to pay")}</Text>
              </View>
            ) : null}
            <Text style={styles.helpText}>
              {" "}{translateUi("Scan the QR code with your banking app or open the PayOS checkout page. Payment status updates automatically.")}{" "}</Text>
            {error ? <Text style={styles.inlineError}>{translateUi(error)}</Text> : null}

            {/* Success banner */}
            {(status === 'COMPLETED' || status === 'SUCCESS') && successCountdown !== null ? (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={28} color="#7EE8A2" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successTitle}>{translateUi("Top-up successful")}</Text>
                  <Text style={styles.successSub}>{translateUi("Returning to your wallet in")}{" "}{successCountdown}s...</Text>
                </View>
              </View>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity activeOpacity={0.8} style={styles.outlineButton} onPress={() => Linking.openURL(payment.checkoutUrl)}>
                  <Text style={styles.outlineButtonText}>{translateUi("Open PayOS")}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.8} style={styles.outlineButton} onPress={checkStatus}>
                  <Text style={styles.outlineButtonText}>{translateUi("Check status")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={cancelLoading}
                  style={[styles.cancelButton, cancelLoading && styles.disabled]}
                  onPress={handleCancelPayment}
                >
                  {cancelLoading ? (
                    <ActivityIndicator color={COLORS.error} size="small" />
                  ) : (
                    <Text style={styles.cancelButtonText}>{translateUi("Cancel")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  scroll: {
    gap: SPACING.lg,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  amountCard: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(212,175,55,0.2)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.md,
    padding: SPACING.md,
  },
  inputWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: SPACING.md,
  },
  input: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
  },
  currency: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  quickChip: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
  },
  quickChipActive: {
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderColor: COLORS.gold,
  },
  quickText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  quickTextActive: {
    color: COLORS.gold,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 54,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
  paymentCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.md,
    padding: SPACING.md,
  },
  paymentHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  paymentTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '800',
  },
  paymentMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  paymentAmount: {
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    color: COLORS.gold,
    fontSize: FONT_SIZES.md,
    fontWeight: '900',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
  },
  qrWrapper: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'white',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  qrHint: {
    color: '#555',
    fontSize: FONT_SIZES.xs,
    textAlign: 'center',
    marginTop: 4,
  },
  helpText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  inlineError: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
  },
  actions: {
    gap: SPACING.sm,
  },
  outlineButton: {
    alignItems: 'center',
    borderColor: 'rgba(212,175,55,0.32)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
  },
  outlineButtonText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  cancelButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.successTint,
    borderColor: 'rgba(126,232,162,0.35)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  successTitle: {
    lineHeight: 24,
    color: COLORS.success,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
  successSub: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
});
