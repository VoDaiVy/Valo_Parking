import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { BookingCard } from '@/components/booking/BookingCard';
import { AppText, Button, EmptyState, LoadingSpinner } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useBooking } from '@/hooks/useBooking';
import type { BookingStackParamList } from '@/navigation/types';
import { borderRadius, colors, spacing } from '@/theme';
import { bookingStatuses, BookingStatus } from '@/types/booking.types';

type Props = NativeStackScreenProps<BookingStackParamList, 'MyBookings'>;
type Filter = BookingStatus | 'all';

export const MyBookingsScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const { bookings, filterStatus, isLoading, fetchBookings, setFilterStatus } = useBooking();

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  const filters: Filter[] = ['all', ...bookingStatuses];
  const filteredBookings = useMemo(
    () =>
      filterStatus === 'all'
        ? bookings
        : bookings.filter((booking) => booking.status === filterStatus),
    [bookings, filterStatus],
  );

  const countFor = (status: Filter) =>
    status === 'all' ? bookings.length : bookings.filter((booking) => booking.status === status).length;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="h1">{translateUi("My Bookings")}</AppText>
        <Button title={translateUi("New")} onPress={() => navigation.navigate('BookingBrowse')} />
      </View>
      <View style={styles.filters}>
        {filters.map((filter) => (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected: filterStatus === filter }}
            onPress={() => setFilterStatus(filter)}
            style={({ pressed }) => [styles.filter, filterStatus === filter && styles.filterActive, filter === 'completed' && filterStatus === filter && styles.filterCompleted, pressed && styles.pressed]}
          >
            <AppText color={filter === 'completed' ? colors.success.main : filterStatus === filter ? colors.light.text.inverse : colors.light.text.primary} variant="caption">
              {filter} ({countFor(filter)})
            </AppText>
          </Pressable>
        ))}
      </View>
      {isLoading && bookings.length === 0 ? <LoadingSpinner /> : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={filteredBookings}
        keyExtractor={(item) => item._id}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState icon="calendar-outline" title={bookings.length === 0 ? translateUi("No bookings yet.") : translateUi("No bookings with this status.")} />
          ) : undefined
        }
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={fetchBookings} />}
        renderItem={({ item }) => (
          <BookingCard
            booking={item}
            onPress={() => navigation.navigate('BookingDetails', { bookingId: item._id })}
          />
        )}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filter: {
    borderColor: colors.light.border,
    borderRadius: borderRadius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterActive: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  filterCompleted: { backgroundColor: colors.success.light, borderColor: colors.success.main },
  pressed: { opacity: 0.85 },
  list: { flexGrow: 1, paddingBottom: spacing.xl },
});
