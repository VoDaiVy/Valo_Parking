import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { WalletStackParamList } from '@/navigation/types';
import { walletService } from '@/services/api/wallet';
import type { TransactionStatus, TransactionType, WalletTransaction } from '@/types/models';
import { formatCurrency, formatDate } from '@/utils/formatters';

type Props = NativeStackScreenProps<WalletStackParamList, 'TransactionHistory'>;
type TypeFilter = 'ALL' | 'TOP_UP' | 'PAYMENT' | 'REFUND';
type TransferType = 'TRANSFER_OUT' | 'TRANSFER_IN' | 'TRANSFER_FEE';
type StatusFilter = 'ALL' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const TYPE_LABELS: Record<TypeFilter, string> = {
  ALL: 'All',
  TOP_UP: 'Top up',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
};
const TRANSFER_TYPE_LABELS: Record<TransferType, string> = {
  TRANSFER_OUT: 'Membership transfer payment',
  TRANSFER_IN: 'Membership transfer proceeds',
  TRANSFER_FEE: 'Membership transfer fee',
};

const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: 'All statuses',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLORS: Record<StatusFilter, string> = {
  ALL: COLORS.gold,
  PENDING: COLORS.warning,
  COMPLETED: COLORS.success,
  FAILED: COLORS.error,
  CANCELLED: COLORS.textMuted,
};

export const TransactionHistoryScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [type, setType] = useState<TypeFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');

  const loadTransactions = useCallback(async () => {
    setError('');
    try {
      const response = await walletService.getTransactions({
        page: 1,
        limit: 20,
        type: type === 'ALL' ? undefined : type,
        status: status === 'ALL' ? undefined : status,
      });
      setTransactions(response.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load transactions.');
      setTransactions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status, type]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadTransactions();
  };

  const renderTransaction = ({ item }: { item: WalletTransaction }) => {
    const itemType = String(item.type as TransactionType);
    const itemStatus = String(item.status as TransactionStatus) as StatusFilter;
    const isCredit = itemType === 'TOP_UP' || itemType === 'REFUND' || itemType === 'TRANSFER_IN';
    const amountColor = isCredit ? COLORS.success : COLORS.warning;
    const statusColor = STATUS_COLORS[itemStatus] ?? COLORS.textMuted;
    const typeLabel =
      TYPE_LABELS[itemType as TypeFilter] ||
      TRANSFER_TYPE_LABELS[itemType as TransferType] ||
      itemType;

    return (
      <View style={styles.transactionCard}>
        <View style={[styles.transactionIcon, { backgroundColor: `${amountColor}18` }]}>
          <Ionicons name={isCredit ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'} size={22} color={amountColor} />
        </View>
        <View style={styles.transactionBody}>
          <View style={styles.transactionTop}>
            <Text style={styles.transactionTitle} numberOfLines={1}>
              {item.description || typeLabel}
            </Text>
            <Text style={[styles.amount, { color: amountColor }]}>
              {isCredit ? '+' : '-'}{formatCurrency(Math.abs(item.amount))}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{typeLabel}</Text>
            <View style={[styles.statusPill, { backgroundColor: `${statusColor}18` }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[itemStatus] || itemStatus}</Text>
            </View>
          </View>
          {item.balanceBefore !== undefined && item.balanceAfter !== undefined ? (
            <Text style={styles.balanceMeta}>
              {formatCurrency(item.balanceBefore)} {'->'} {formatCurrency(item.balanceAfter)}
            </Text>
          ) : null}
          <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={translateUi("Wallet history")} onBack={() => navigation.goBack()} />

      <View style={styles.filtersBlock}>
        <FlatList
          horizontal
          data={Object.keys(TYPE_LABELS) as TypeFilter[]}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <Pressable style={[styles.chip, type === item && styles.chipActive]} onPress={() => setType(item)}>
              <Text style={[styles.chipText, type === item && styles.chipTextActive]}>{TYPE_LABELS[item]}</Text>
            </Pressable>
          )}
          showsHorizontalScrollIndicator={false}
        />
        <FlatList
          horizontal
          data={Object.keys(STATUS_LABELS) as StatusFilter[]}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <Pressable style={[styles.chip, status === item && styles.chipActive]} onPress={() => setStatus(item)}>
              <Text style={[styles.chipText, status === item && styles.chipTextActive]}>{STATUS_LABELS[item]}</Text>
            </Pressable>
          )}
          showsHorizontalScrollIndicator={false}
        />
      </View>

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={loadTransactions} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={transactions}
          keyExtractor={(item, index) => item.id || item._id || String(index)}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={translateUi("No transactions yet")}
              message={translateUi("Top-ups, payments, and refunds will appear here.")}
            />
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />
          }
          renderItem={renderTransaction}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  filtersBlock: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    justifyContent: 'center',
    marginRight: SPACING.sm,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  chipActive: {
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderColor: COLORS.gold,
  },
  chipText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  chipTextActive: {
    color: COLORS.gold,
  },
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  list: {
    gap: SPACING.md,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  transactionCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  transactionIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  transactionBody: {
    minWidth: 0,
    flex: 1,
    gap: 5,
  },
  transactionTop: {
    flexWrap: 'wrap',
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  transactionTitle: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  amount: {
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    lineHeight: 20,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
  },
  metaRow: {
    flexWrap: 'wrap',
    gap: SPACING.sm,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
  },
  statusPill: {
    borderRadius: RADIUS.round,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  balanceMeta: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  dateText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
});
