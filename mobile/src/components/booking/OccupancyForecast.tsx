import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { format } from 'date-fns';
import { apiClient } from '@/services/api/client';
import type { APIResponse } from '@/types/api';
import { COLORS } from '@/constants/theme';
import { workflowStyles as s, WorkflowChip } from '@/components/common/WorkflowUI';

interface HourForecast {
  hour: number;
  timeLabel: string;
  busynessScore: number;
}

export function OccupancyForecast({
  floorId,
  onSelectTime,
}: {
  floorId?: string;
  onSelectTime: (startTime: string, endTime: string) => void;
}) {
  const [hours, setHours] = useState<HourForecast[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<HourForecast | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const response = await apiClient.get<APIResponse<{ hourlyForecast: HourForecast[] }>>(
        '/ai/occupancy-forecast',
        { params: { floorId, date: format(new Date(), 'yyyy-MM-dd'), timeframe: 'day' } },
      );
      setHours(response.data?.hourlyForecast || []);
    } catch (e) {
      setHours([]);
      setError(e instanceof Error ? e.message : 'Unable to load the forecast.');
    } finally {
      setLoading(false);
    }
  }, [floorId]);
  useEffect(() => {
    void load();
  }, [load]);
  const chooseHour = (hour: HourForecast) => {
    const start = new Date();
    start.setHours(hour.hour, 0, 0, 0);
    if (start <= new Date()) return;
    onSelectTime(start.toISOString(), new Date(start.getTime() + 60 * 60_000).toISOString());
  };
  return (
    <View style={[s.panel, { margin: 16 }]}>
      <Text style={s.title}>Expected peak hours</Text>
      <Text style={s.body}>
        Select an hour to view expected demand and start a booking. Availability is checked against your booking times.
      </Text>
      {loading ? <ActivityIndicator color={COLORS.gold} /> : null}
      {error ? (
        <>
          <Text style={s.error}>{error}</Text>
          <WorkflowChip onPress={() => void load()}>Reload forecast</WorkflowChip>
        </>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, minHeight: 112, alignItems: 'flex-end' }}
      >
        {hours.map((hour) => (
          <Pressable
            key={hour.hour}
            accessibilityRole="button"
            accessibilityLabel={`${hour.timeLabel}, expected occupancy ${hour.busynessScore}%`}
            onPress={() => setSelected(hour)}
            style={{ width: 40, alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 26,
                height: Math.max(8, Math.min(80, hour.busynessScore * 0.8)),
                backgroundColor: selected?.hour === hour.hour ? COLORS.gold : COLORS.textMuted,
                borderRadius: 4,
              }}
            />
            <Text style={[s.body, { fontSize: 11 }]}>{hour.timeLabel || `${hour.hour}h`}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {selected ? (
        <>
          <Text style={s.body}>
            {selected.timeLabel}: expected occupancy {selected.busynessScore}%
          </Text>
          {selected.hour > new Date().getHours() ? (
            <WorkflowChip onPress={() => chooseHour(selected)}>
              Book from {selected.timeLabel}
            </WorkflowChip>
          ) : (
            <Text style={s.body}>This hour has passed. Choose a later hour to book.</Text>
          )}
        </>
      ) : null}
    </View>
  );
}
