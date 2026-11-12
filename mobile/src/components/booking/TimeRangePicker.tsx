import { useLanguage } from '@/contexts/LanguageContext';
import { StyleSheet, View } from 'react-native';

import { AppText, Input } from '@/components/common';
import { borderRadius, colors, spacing } from '@/theme';
import { formatDuration, validateTimeRange } from '@/utils/bookingValidation';

interface TimeRangePickerProps {
  startTime: Date;
  endTime: Date;
  onStartTimeChange: (date: Date) => void;
  onEndTimeChange: (date: Date) => void;
  errorMessage?: string;
}

const toInputValue = (date: Date) => date.toISOString().slice(0, 16);

const parseInputValue = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const TimeRangePicker = ({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  errorMessage,
}: TimeRangePickerProps) => {
  const { t: translateUi } = useLanguage();
  const validation = validateTimeRange(startTime, endTime);
  const error = errorMessage || validation.error;

  return (
    <View style={styles.container}>
      <Input
        label={translateUi("Start time")}
        onChangeText={(value) => {
          const parsed = parseInputValue(value);
          if (parsed) {
            onStartTimeChange(parsed);
          }
        }}
        placeholder="YYYY-MM-DDTHH:mm"
        value={toInputValue(startTime)}
      />
      <Input
        label={translateUi("End time")}
        onChangeText={(value) => {
          const parsed = parseInputValue(value);
          if (parsed) {
            onEndTimeChange(parsed);
          }
        }}
        placeholder="YYYY-MM-DDTHH:mm"
        value={toInputValue(endTime)}
      />
      <View style={styles.duration}>
        <AppText color={colors.light.text.secondary} style={styles.durationText} variant="body2">
          {" "}{translateUi("Duration:")}{" "}{formatDuration(startTime, endTime)}
        </AppText>
      </View>
      {error ? (
        <AppText accessibilityLiveRegion="polite" color={colors.error.main} style={styles.error} variant="body2">
          {translateUi(error)}
        </AppText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  duration: { backgroundColor: colors.light.surfaceElevated, borderRadius: borderRadius.md, padding: spacing.md },
  durationText: { fontWeight: '500', fontVariant: ['tabular-nums'] },
  error: { backgroundColor: colors.error.light, borderRadius: borderRadius.md, padding: spacing.md },
});
