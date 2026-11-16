import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, AppState, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { feedbackService } from '@/services/api/feedback';
import { useSocket } from '@/hooks/useSocket';
import type { BookingFeedback, FeedbackCategory } from '@/types/feedback.types';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'parking', label: 'Parking space' }, { value: 'staff', label: 'Staff' },
  { value: 'payment', label: 'Payment' }, { value: 'app', label: 'Application' },
  { value: 'other', label: 'Other' },
];

function replyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' });
}

export function BookingFeedbackSection({ bookingId, canSubmit }: { bookingId: string; canSubmit: boolean }) {
  const { t } = useLanguage();
  const socket = useSocket();
  const [feedback, setFeedback] = useState<BookingFeedback | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [categories, setCategories] = useState<FeedbackCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  const activeBooking = useRef<string | null>(null);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && previousState !== 'active') {
        setReload((value) => value + 1);
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const handler = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const metadata = (payload as { metadata?: { eventType?: unknown; bookingId?: unknown } }).metadata;
      if (metadata?.eventType === 'BOOKING_FEEDBACK_REPLIED' && metadata.bookingId === bookingId) {
        setReload((value) => value + 1);
      }
    };
    socket.on('notification:new', handler);
    const reconnected = () => setReload((value) => value + 1);
    socket.on('connect', reconnected);
    return () => {
      socket.off('notification:new', handler);
      socket.off('connect', reconnected);
    };
  }, [socket, bookingId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    activeBooking.current = bookingId;
    setLoading(true);
    setSaving(submitting.current);
    setLoadFailed(false);
    setError('');
    void feedbackService.get(bookingId).then((response) => {
      if (active) setFeedback((current) => response.data || current);
    }).catch((cause: unknown) => {
      if (active) {
        setLoadFailed(true);
        setError(cause instanceof Error ? cause.message : 'Unable to load feedback.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; activeBooking.current = null; };
  }, [bookingId, reload]));

  const submit = async () => {
    if (submitting.current || !rating || !canSubmit || feedback) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await feedbackService.create(bookingId, { rating, comment: comment.trim(), categories });
      if (activeBooking.current === bookingId) setFeedback(response.data);
    } catch (cause: unknown) {
      if (activeBooking.current !== bookingId) return;
      if ((cause as { status?: number })?.status === 409) {
        try {
          const existing = await feedbackService.get(bookingId);
          if (activeBooking.current === bookingId) {
            setFeedback(existing.data);
            if (!existing.data) setError('Feedback already exists. Please reload.');
          }
        } catch {
          if (activeBooking.current === bookingId) setError('Feedback already exists. Please reload.');
        }
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to send feedback. Please try again.');
      }
    } finally {
      submitting.current = false;
      if (activeBooking.current === bookingId) setSaving(false);
    }
  };

  return <View style={styles.section}>
    <Text style={styles.title}>{t('Your experience')}</Text>
    {loading ? <ActivityIndicator accessibilityLabel={t('Loading feedback')} color={COLORS.gold} /> : null}
    {error ? <View accessibilityLiveRegion="polite">
      <Text style={styles.error}>{t(error)}</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={() => setReload((value) => value + 1)}>
        <Text style={styles.link}>{t('Reload feedback')}</Text>
      </TouchableOpacity>
    </View> : null}
    {!loading && feedback ? <>
      <Text style={styles.stars} accessibilityLabel={`${feedback.rating}/5`}>{'★'.repeat(feedback.rating)}{'☆'.repeat(5 - feedback.rating)}</Text>
      {feedback.comment ? <Text style={styles.body}>{feedback.comment}</Text> : null}
      {feedback.categories?.length ? <Text style={styles.muted}>{feedback.categories.map((category) => t(CATEGORIES.find((item) => item.value === category)?.label || category)).join(' · ')}</Text> : null}
      {feedback.reply ? <View style={styles.reply}>
        <Text style={styles.replyTitle}>{t('Reply from Valo Parking')}</Text>
        <Text style={styles.body}>{feedback.reply.content}</Text>
        <Text style={styles.muted}>{t('Updated')}: {replyDate(feedback.reply.updatedAt || feedback.reply.repliedAt)}</Text>
      </View> : <Text style={styles.muted}>{t('Thank you. Your feedback is awaiting a reply.')}</Text>}
    </> : null}
    {!loading && !loadFailed && !feedback && canSubmit ? <>
      <Text style={styles.muted}>{t('How was your parking experience?')}</Text>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((value) => <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`${value}/5`} accessibilityState={{ selected: rating === value, disabled: saving }} disabled={saving} style={styles.starButton} onPress={() => setRating(value)}>
          <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={30} color={COLORS.gold} />
        </TouchableOpacity>)}
      </View>
      <Text style={styles.muted}>{t('Topics (optional)')}</Text>
      <View style={styles.chips}>{CATEGORIES.map(({ value, label }) => <TouchableOpacity key={value} accessibilityRole="checkbox" accessibilityState={{ checked: categories.includes(value), disabled: saving }} disabled={saving} style={[styles.chip, categories.includes(value) && styles.selectedChip]} onPress={() => setCategories((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])}>
        <Text style={categories.includes(value) ? styles.link : styles.muted}>{t(label)}</Text>
      </TouchableOpacity>)}</View>
      <TextInput accessibilityLabel={t('Feedback comment (optional)')} placeholder={t('Share what went well or could improve (optional)')} placeholderTextColor={COLORS.textMuted} multiline maxLength={1000} editable={!saving} value={comment} onChangeText={setComment} style={styles.input} textAlignVertical="top" />
      <Text style={styles.counter}>{comment.length}/1000</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !rating || saving }} disabled={!rating || saving} onPress={() => void submit()} style={[styles.submit, (!rating || saving) && styles.disabled]}>
        {saving ? <ActivityIndicator color={COLORS.textInverse} /> : <Text style={styles.submitLabel}>{t('Send feedback')}</Text>}
      </TouchableOpacity>
      <Text style={styles.muted}>{t('One review per completed booking. Your review cannot be edited after sending.')}</Text>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { padding: SPACING.md, gap: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  body: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 23 },
  muted: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 },
  stars: { color: COLORS.gold, fontSize: 28 },
  row: { flexDirection: 'row' }, starButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.round, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  selectedChip: { borderColor: COLORS.gold, backgroundColor: COLORS.goldTint },
  input: { minHeight: 110, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.md, padding: 12, color: COLORS.textPrimary, fontSize: 15 },
  counter: { textAlign: 'right', color: COLORS.textMuted, fontSize: 12 },
  submit: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gold, borderRadius: RADIUS.md },
  submitLabel: { color: COLORS.textInverse, fontWeight: '700', fontSize: 15 }, disabled: { opacity: 0.5 },
  reply: { padding: 14, borderLeftWidth: 3, borderLeftColor: COLORS.gold, backgroundColor: COLORS.surfaceElevated, gap: 8 },
  replyTitle: { color: COLORS.goldLight, fontWeight: '700', fontSize: 14 },
  error: { color: COLORS.error, lineHeight: 20 }, link: { color: COLORS.gold, fontSize: 13 }, retry: { minHeight: 44, justifyContent: 'center' },
});
