import { useLanguage } from '@/contexts/LanguageContext';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { CONTROL, FONT_SIZES } from '@/constants/theme';
import { apiClient } from '@/services/api/client';
import type { APIResponse } from '@/types/api';
import { COLORS } from '@/constants/theme';
import { workflowStyles as s, WorkflowChip } from '@/components/common/WorkflowUI';

interface HourForecast {
  hour: number;
  timeLabel: string;
  busynessScore: number | null;
  estimatedOccupiedSlots: number;
  dataKind: 'recorded' | 'estimated' | 'known_only';
}

interface Forecast {
  date: string;
  totalCapacity: number;
  hourlyForecast: HourForecast[];
}

export function OccupancyForecast({
  floorId,
  onSelectTime,
}: {
  floorId?: string;
  onSelectTime: (startTime: string, endTime: string) => void;
}) {
  const { t: translateUi } = useLanguage();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<HourForecast | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const response = await apiClient.get<APIResponse<Forecast>>(
        '/ai/occupancy-forecast',
        { signal, params: { floorId, timeframe: 'day' } },
      );
      if (!Array.isArray(response.data?.hourlyForecast) || !response.data.hourlyForecast.every(hour => hour.dataKind)) {
        throw new Error('Unable to load the forecast.');
      }
      if (!signal?.aborted) setForecast(response.data);
    } catch (e) {
      if (!signal?.aborted) {
        setForecast(null);
        setError(e instanceof Error ? e.message : 'Unable to load the forecast.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [floorId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const startTime = (hour: HourForecast) => new Date(`${forecast?.date}T${hour.timeLabel}:00+07:00`);
  const chooseHour = (hour: HourForecast) => {
    const start = startTime(hour);
    if (start <= new Date()) return;
    onSelectTime(start.toISOString(), new Date(start.getTime() + 60 * 60_000).toISOString());
  };
  const describeHour = (hour: HourForecast) => {
    const label = hour.dataKind === 'estimated' ? 'Estimated occupancy'
      : hour.dataKind === 'recorded' ? 'Recorded occupancy' : 'Spaces with recorded activity';
    const value = hour.dataKind === 'estimated' ? `${hour.busynessScore}%` : hour.estimatedOccupiedSlots;
    return `${hour.timeLabel} · ${translateUi(label)} · ${value}`;
  };
  return (
    <View style={[s.panel, { margin: 16 }]}>
      <Text style={s.title}>{translateUi("Parking occupancy")}</Text>
      <Text style={s.body}>
        {" "}{translateUi("Select an hour to view expected demand and start a booking. Availability is checked against your booking times.")}{" "}</Text>
      {loading ? <ActivityIndicator color={COLORS.gold} /> : null}
      {error ? (
        <>
          <Text style={s.error}>{translateUi(error)}</Text>
          <WorkflowChip onPress={() => void load()}>{translateUi("Reload forecast")}</WorkflowChip>
        </>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, minHeight: 112, alignItems: 'flex-end' }}
      >
        {forecast?.totalCapacity ? forecast.hourlyForecast.map((hour) => (
          <Pressable
            key={hour.hour}
            accessibilityRole="button"
            accessibilityState={{ selected: selected?.hour === hour.hour }}
            accessibilityLabel={describeHour(hour)}
            onPress={() => setSelected(hour)}
            style={{ minWidth: CONTROL.minTouchSize, minHeight: CONTROL.minTouchSize, alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 26,
                height: Math.max(8, Math.min(80, (hour.busynessScore ?? 0) * 0.8)),
                backgroundColor: selected?.hour === hour.hour ? COLORS.gold : COLORS.textMuted,
                borderRadius: 4,
              }}
            />
            <Text style={[s.body, { fontSize: FONT_SIZES.xs }]}>{hour.timeLabel || `${hour.hour}h`}</Text>
          </Pressable>
        )) : null}
      </ScrollView>
      {forecast?.totalCapacity === 0 ? <Text style={s.body}>{translateUi("No eligible hourly spaces")}</Text> : null}
      {selected ? (
        <>
          <Text style={s.body}>{describeHour(selected)}</Text>
          {selected.dataKind === 'known_only' && <Text style={s.body}>{translateUi("Not enough history to estimate availability.")}</Text>}
          {startTime(selected) > new Date() ? (
            <WorkflowChip onPress={() => chooseHour(selected)}>
              {" "}{translateUi("Book from")}{" "}{selected.timeLabel}
            </WorkflowChip>
          ) : (
            <Text style={s.body}>{translateUi("This hour has passed. Choose a later hour to book.")}</Text>
          )}
        </>
      ) : null}
    </View>
  );
}
