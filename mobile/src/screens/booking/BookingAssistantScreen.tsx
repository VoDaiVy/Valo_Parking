import { useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ScreenHeader } from '@/components/common';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import type { BookingStackParamList } from '@/navigation/BookingStackNavigator';
import { assistantService, type AiBookingDraft } from '@/services/api/assistant';
import { getAiBookingRange } from '@/utils/aiBookingDraft';
import { formatDate } from '@/utils/formatters';

export function BookingAssistantScreen({
  navigation,
}: NativeStackScreenProps<BookingStackParamList, 'BookingAssistant'>) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [draft, setDraft] = useState<AiBookingDraft>({});
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const send = async () => {
    if (!prompt.trim() || inFlight.current) return;
    const message = prompt.trim();
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const now = new Date();
      const vietnamNow = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60_000);
      const response = await assistantService.interpret(
        message,
        draft,
        format(vietnamNow, 'yyyy-MM-dd'),
        format(vietnamNow, 'HH:mm'),
      );
      if (!response.data) throw new Error('No response received.');
      const result = response.data;
      setDraft(result.draft || {});
      setPrompt('');
      setMessages((items) => [
        ...items,
        { role: 'user', text: message },
        {
          role: 'assistant',
          text:
            result.assistantResult?.message ||
            result.clarification ||
            (getAiBookingRange(result.draft || {})
              ? 'Your parking schedule is ready. Review the draft below to choose a space and continue to payment.'
              : 'What date and start and end times would you like to book?'),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant is unavailable. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const drafts = draft.reservationItems?.length ? draft.reservationItems : [draft];
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader
        title="AI parking assistant"
        subtitle="Ask about vehicles, bookings or your wallet, or describe your parking schedule"
        onBack={() => navigation.goBack()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {!messages.length ? (
            <View style={s.panel}>
              <Text style={s.title}>How can we help?</Text>
              <Text style={s.body}>
                For example: “Book parking tomorrow for 30A12345 from 8 AM to 5 PM”, “Where is my vehicle?” or “What is my wallet balance?”
              </Text>
            </View>
          ) : null}
          {messages.map((message, index) => (
            <View
              key={index}
              style={[
                s.panel,
                message.role === 'user' && {
                  marginLeft: 32,
                  backgroundColor: COLORS.surfaceElevated,
                },
              ]}
            >
              <Text
                style={[
                  s.body,
                  { color: message.role === 'assistant' ? COLORS.gold : COLORS.textMuted },
                ]}
              >
                {message.role === 'user' ? 'You' : 'VALO AI'}
              </Text>
              <Text selectable style={s.body}>
                {message.text}
              </Text>
            </View>
          ))}
          {drafts.map((item, index) => {
            const range = getAiBookingRange(item);
            return range ? (
              <View key={index} style={s.panel}>
                <Text style={s.title}>Proposed schedule {drafts.length > 1 ? index + 1 : ''}</Text>
                <Text style={s.body}>
                  {item.licensePlate || 'Select a vehicle in the next step'} ·{' '}
                  {item.floorName || 'Select a floor'}
                </Text>
                <Text style={s.body}>
                  {formatDate(range.startTime)} → {formatDate(range.endTime)}
                </Text>
                <WorkflowButton
                  title="Review & choose a space"
                  disabled={busy}
                  onPress={() =>
                    navigation.navigate('CreateBooking', {
                      initialStartTime: range.startTime,
                      initialEndTime: range.endTime,
                      initialLicensePlate: item.licensePlate,
                    })
                  }
                />
              </View>
            ) : null;
          })}
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {busy ? <ActivityIndicator color={COLORS.gold} /> : null}
          <TextInput
            accessibilityLabel="Request for the AI assistant"
            multiline
            maxLength={2000}
            editable={!busy}
            style={[s.input, { minHeight: 90 }]}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Enter your request…"
            placeholderTextColor={COLORS.textMuted}
          />
          <WorkflowButton
            title={busy ? 'Processing…' : 'Send request'}
            disabled={busy || !prompt.trim()}
            onPress={() => void send()}
          />
          <WorkflowChip onPress={() => navigation.navigate('CreateBooking')}>
            Choose times & a space manually
          </WorkflowChip>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
