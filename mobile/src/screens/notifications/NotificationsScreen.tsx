import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { NotificationCard } from '@/components/notifications/NotificationCard';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useNotifications } from '@/hooks/useNotifications';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { NotificationStackParamList } from '@/navigation/types';
import {
  getNotificationId,
  getNotificationNavigationTarget,
  NOTIFICATION_TYPES,
  type NotificationFilter,
} from '@/utils/notifications';

type Props = NativeStackScreenProps<NotificationStackParamList, 'Notifications'>;

const filters: NotificationFilter[] = ['ALL', 'UNREAD', 'READ', ...NOTIFICATION_TYPES];

const FILTER_LABELS: Record<NotificationFilter, string> = {
  ALL: 'All',
  UNREAD: 'Unread',
  READ: 'Read',
  SYSTEM: 'System',
  PARKING: 'Parking',
  BOOKING: 'Booking',
  WALLET: 'Wallet',
  PAYMENT: 'Payment',
  ACCOUNT: 'Account',
  PROMOTION: 'Promotions',
  CAMERA: 'Camera',
  VIOLATION: 'Violations',
};

export const NotificationsScreen = ({ navigation }: Props) => {
  const [filter, setFilter] = useState<NotificationFilter>('ALL');
  const {
    notifications,
    unreadCount,
    loading,
    refreshing,
    error,
    hasMore,
    refetch,
    loadMore,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications(filter);

  const openNotification = async (id: string, notification: Parameters<typeof getNotificationNavigationTarget>[0]) => {
    if (id) await markAsRead(id).catch(() => undefined);
    const target = getNotificationNavigationTarget(notification);
    const tabs = navigation.getParent<NavigationProp<CustomerTabParamList>>();
    if (!target || !tabs) return;

    if (target.tab === 'WalletTab') {
      if (target.screen === 'Wallet') {
        tabs.navigate('WalletTab', { screen: 'Wallet' });
      } else if (target.screen === 'Membership') {
        tabs.navigate('WalletTab', { screen: 'Membership' });
      } else {
        tabs.navigate('WalletTab', {
          screen: 'MembershipMarketplaceDetail',
          params: target.params,
        });
      }
    } else if (target.tab === 'Bookings') {
      tabs.navigate('Bookings', {
        screen: 'BookingDetail',
        params: target.params,
      });
    } else {
      tabs.navigate('ProfileTab', { screen: 'Profile' });
    }
  };

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      );
    }

    if (error) {
      return <ErrorState message={error} onRetry={refetch} />;
    }

    return (
      <EmptyState
        icon="notifications-outline"
        title="No notifications"
        message="Updates about bookings, your wallet, and your account will appear here."
      />
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <ScreenHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'Up to date'}
        right={
          unreadCount > 0 ? (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.75}
              style={styles.readAllButton}
              onPress={() => void markAllAsRead()}
            >
              <Ionicons name="checkmark-done-outline" size={16} color={COLORS.gold} />
              <Text style={styles.readAllText}>Mark all read</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <FlatList
        contentContainerStyle={styles.list}
        data={notifications}
        keyExtractor={(item, index) => getNotificationId(item) || String(index)}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          hasMore && notifications.length > 0 ? (
            <ActivityIndicator color={COLORS.gold} style={styles.footerLoader} />
          ) : null
        }
        ListHeaderComponent={
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {filters.map((item) => {
              const active = filter === item;
              const label = item === 'UNREAD' && unreadCount > 0
                ? `${FILTER_LABELS[item]} ${unreadCount > 99 ? '99+' : unreadCount}`
                : FILTER_LABELS[item];

              return (
                <Pressable
                  key={item}
                  style={[styles.filter, active && styles.filterActive]}
                  onPress={() => setFilter(item)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={COLORS.gold} colors={[COLORS.gold]} />
        }
        renderItem={({ item }) => {
          const id = getNotificationId(item);
          return (
            <NotificationCard
              notification={item}
              onDelete={() => void deleteNotification(id)}
              onPress={() => void openNotification(id, item)}
            />
          );
        }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasMore) loadMore();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  readAllButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderColor: 'rgba(212,175,55,0.25)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: SPACING.sm,
  },
  readAllText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  filters: {
    gap: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  filter: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  filterActive: {
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderColor: COLORS.gold,
  },
  filterText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  filterTextActive: {
    color: COLORS.gold,
  },
  stateWrap: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
  },
  footerLoader: {
    paddingVertical: SPACING.lg,
  },
});
