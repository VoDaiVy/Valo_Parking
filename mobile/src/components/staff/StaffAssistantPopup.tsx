import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING } from '@/constants/theme';
import { WorkflowButton, WorkflowChip, workflowStyles } from '@/components/common/WorkflowUI';
import { assistantService, type CopilotReply } from '@/services/api/assistant';
import { ValoAIMascot } from './ValoAIMascot';

interface Props {
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
}
interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: CopilotReply;
}
const SUGGESTIONS = [
  'Which vehicles are parked?',
  'Find recent bookings',
  'Which spaces are available?',
];
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  content: 'Content',
  status: 'Status',
  priority: 'Priority',
};

export function StaffAssistantPopup({ visible, onOpen, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'approve' | 'reject'>>({});
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const counter = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      mounted.current = false;
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [visible, messages, busy]);

  const send = async (value = prompt) => {
    const question = value.trim();
    if (!question || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPrompt('');
    setMessages((items) => [...items, { id: ++counter.current, role: 'user', text: question }]);
    try {
      const response = await assistantService.chat(question, conversationId);
      if (!response.success || !response.data) throw new Error('No AI response received.');
      if (!mounted.current) return;
      const reply = response.data;
      setConversationId(reply.conversationId);
      setMessages((items) => [
        ...items,
        { id: ++counter.current, role: 'assistant', text: reply.message, reply },
      ]);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Unable to connect to the assistant.');
        setPrompt(question);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    if (inFlight.current || decisions[id]) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await assistantService.decideDraft(id, decision);
      if (!response.success) throw new Error('Unable to process the draft.');
      if (!mounted.current) return;
      setDecisions((items) => ({ ...items, [id]: decision }));
      setConfirmationId(null);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Unable to process the draft.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <>
      {!visible && !keyboardVisible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open VALO AI chat"
          onPress={onOpen}
          style={({ pressed }) => [
            styles.launcher,
            { bottom: Math.max(insets.bottom, 12) + 84, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View pointerEvents="none" style={styles.mascotGlow} />
          <ValoAIMascot />
          <Text style={styles.launcherLabel}>VALO AI</Text>
          {busy ? <View testID="assistant-busy-indicator" style={styles.busyDot} /> : null}
        </Pressable>
      ) : null}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss VALO AI chat"
            style={StyleSheet.absoluteFill}
            onPress={close}
          />
          <View
            accessibilityViewIsModal
            testID="staff-assistant-popup"
            style={[
              styles.popup,
              {
                width: Math.min(width - 24, 460),
                height: Math.min(640, height - insets.top - insets.bottom - 48),
                marginTop: insets.top + 12,
                marginBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.avatar}>
                <ValoAIMascot size={44} />
              </View>
              <View style={styles.heading}>
                <Text style={styles.title}>VALO AI</Text>
                <Text style={styles.subtitle}>Your staff assistant</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Minimize VALO AI chat"
                onPress={close}
                style={styles.iconButton}
              >
                <Ionicons name="remove" size={23} color={COLORS.textSecondary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close VALO AI chat"
                onPress={close}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={23} color={COLORS.textPrimary} />
              </Pressable>
            </View>
            <View style={styles.chatLabel}>
              <View style={styles.statusDot} />
              <Text style={styles.chatLabelText}>Operations chat</Text>
            </View>
            <ScrollView
              ref={scroll}
              style={styles.conversation}
              contentContainerStyle={styles.messages}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {!messages.length ? (
                <View style={styles.welcome}>
                  <Text style={styles.welcomeTitle}>How can I help with your shift?</Text>
                  <Text style={styles.body}>
                    Look up vehicles, reservations and available spaces, or prepare an action for
                    review.
                  </Text>
                  {SUGGESTIONS.map((question) => (
                    <Pressable
                      key={question}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void send(question)}
                      style={styles.suggestion}
                    >
                      <Text style={styles.suggestionText}>{question}</Text>
                      <Ionicons name="arrow-forward" size={16} color={COLORS.gold} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {messages.map((message) => {
                const draft = message.reply?.draft;
                const draftId = draft?.id || draft?._id;
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.bubble,
                      message.role === 'user' ? styles.userBubble : styles.aiBubble,
                    ]}
                  >
                    <Text style={styles.sender}>{message.role === 'user' ? 'You' : 'VALO AI'}</Text>
                    <Text selectable style={styles.body}>
                      {message.text}
                    </Text>
                    {message.reply?.evidence?.length ? (
                      <Text style={styles.subtitle}>
                        Based on {message.reply.evidence.length} data sources
                      </Text>
                    ) : null}
                    {draft && draftId ? (
                      <View style={styles.draft}>
                        <Text style={styles.draftTitle}>
                          {draft.type === 'SEND_NOTIFICATION'
                            ? 'Suggested notification'
                            : 'Suggested account update'}
                        </Text>
                        <Text style={styles.body}>
                          {draft.reason || draft.summary || 'Review the proposed changes.'}
                        </Text>
                        {draft.current ? (
                          <Text style={styles.body}>
                            Account:{' '}
                            {draft.current.username || draft.current.email || 'Selected account'}
                          </Text>
                        ) : null}
                        {Object.entries(draft.payload || {})
                          .filter(([key]) => key in FIELD_LABELS)
                          .map(([key, value]) => (
                            <Text key={key} style={styles.body}>
                              {FIELD_LABELS[key]}:{' '}
                              {typeof value === 'boolean'
                                ? value
                                  ? 'Active'
                                  : 'Locked'
                                : String(value)}
                            </Text>
                          ))}
                        {decisions[draftId] ? (
                          <Text style={styles.draftTitle}>
                            {decisions[draftId] === 'approve'
                              ? 'Applied successfully'
                              : 'Draft rejected'}
                          </Text>
                        ) : confirmationId === draftId ? (
                          <>
                            <Text style={styles.body}>Apply these changes now?</Text>
                            <WorkflowButton
                              title="Confirm changes"
                              disabled={busy}
                              onPress={() => void decide(draftId, 'approve')}
                            />
                            <WorkflowChip onPress={() => !busy && setConfirmationId(null)}>
                              Cancel
                            </WorkflowChip>
                          </>
                        ) : (
                          <>
                            <WorkflowButton
                              title="Review & apply"
                              disabled={busy}
                              onPress={() => setConfirmationId(draftId)}
                            />
                            <WorkflowChip onPress={() => !busy && void decide(draftId, 'reject')}>
                              Reject draft
                            </WorkflowChip>
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {busy ? (
                <View accessibilityLiveRegion="polite" style={styles.thinking}>
                  <ActivityIndicator size="small" color={COLORS.gold} />
                  <Text style={styles.subtitle}>VALO AI is working…</Text>
                </View>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={workflowStyles.error}>
                  {error}
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Message VALO AI"
                multiline
                maxLength={2000}
                editable={!busy}
                value={prompt}
                onChangeText={setPrompt}
                placeholder="Ask VALO AI…"
                placeholderTextColor={COLORS.textMuted}
                style={styles.input}
                onFocus={() => scroll.current?.scrollToEnd({ animated: true })}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: busy || !prompt.trim() }}
                disabled={busy || !prompt.trim()}
                onPress={() => void send()}
                style={[styles.send, (busy || !prompt.trim()) && styles.disabled]}
              >
                <Ionicons name="arrow-up" size={23} color={COLORS.textInverse} />
              </Pressable>
            </View>
            <Text style={styles.footer}>Changes are only applied after your confirmation.</Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute',
    right: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: 88,
    height: 96,
    paddingTop: 8,
    borderRadius: 24,
  },
  launcherLabel: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: -2,
  },
  mascotGlow: {
    position: 'absolute',
    top: 18,
    width: 62,
    height: 58,
    borderRadius: 30,
    backgroundColor: 'rgba(226,186,75,0.12)',
    shadowColor: COLORS.gold,
    shadowOpacity: 0.65,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  busyDot: {
    position: 'absolute',
    left: 6,
    top: 12,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.gold,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  popup: {
    flexShrink: 1,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.goldDark,
    overflow: 'hidden',
    elevation: 16,
  },
  header: {
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,186,75,0.1)',
    borderRadius: 14,
    marginRight: 10,
  },
  heading: { flex: 1 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 12, lineHeight: 18, color: COLORS.textMuted },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chatLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  chatLabelText: { color: COLORS.gold, fontSize: 12, fontWeight: '600' },
  conversation: { flex: 1 },
  messages: { padding: 16, gap: 14 },
  welcome: { gap: 12, paddingVertical: SPACING.sm },
  welcomeTitle: { fontSize: 21, lineHeight: 28, fontWeight: '700', color: COLORS.textPrimary },
  body: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 22 },
  suggestion: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 12,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  suggestionText: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  bubble: { borderRadius: 15, padding: 13, gap: 6, maxWidth: '94%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#34301F', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  sender: { fontSize: 11, fontWeight: '700', color: COLORS.gold },
  draft: { gap: 10, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderColor: COLORS.border },
  draftTitle: { color: COLORS.gold, fontSize: 14, fontWeight: '700' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    color: COLORS.textPrimary,
    fontSize: 14,
    lineHeight: 21,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  footer: {
    color: COLORS.textMuted,
    fontSize: 10,
    lineHeight: 15,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: COLORS.surface,
  },
});
