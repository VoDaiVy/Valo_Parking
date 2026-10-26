import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import {
  ActionButton,
  AnimatedPressable,
  FadeInView,
  OperationalRow,
  SectionTitle,
  SkeletonBlock,
  StaffHeader,
  StatusBadge,
} from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useToast } from '@/hooks/useToast';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { notificationsService, type StaffNotificationInput } from '@/services/api/notifications';
import { staffService, type StaffCustomer } from '@/services/api/staff';
import type { UserNotification } from '@/types/models';
import { NOTIFICATION_TYPES } from '@/utils/notifications';
import { WorkflowChip, workflowStyles as workflow } from '@/components/common/WorkflowUI';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'StaffNotifications'>;
type Audience = StaffNotificationInput['targetType'];
const priorities: StaffNotificationInput['priority'][] = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM'];

const priorityTone = (priority?: string) => {
  if (priority === 'SUCCESS') return 'success' as const;
  if (priority === 'WARNING') return 'warning' as const;
  if (priority === 'ERROR') return 'danger' as const;
  return 'info' as const;
};

export function StaffNotificationManagementScreen({ navigation }: Props) {
  const [tab, setTab] = useState<'history' | 'compose'>('history');
  const [history, setHistory] = useState<UserNotification[]>([]);
  const [customers, setCustomers] = useState<StaffCustomer[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>('ROLE_BASED');
  const [roles, setRoles] = useState<Array<'customer' | 'staff' | 'admin'>>(['customer']);
  const [type, setType] = useState<StaffNotificationInput['type']>('SYSTEM');
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<StaffNotificationInput['priority']>('INFO');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      const [historyResponse, customerResponse] = await Promise.all([
        notificationsService.getStaffHistory({ page }),
        staffService.getCustomers(),
      ]);
      setHistory(historyResponse.data ?? []);
      setHasNext(page < (historyResponse.pagination?.totalPages || 1));
      setCustomers(customerResponse.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => customers.filter((customer) =>
      `${customer.profile?.fullName ?? ''} ${customer.username ?? ''} ${customer.email}`.toLowerCase().includes(search.toLowerCase()),
    ),
    [customers, search],
  );

  const chooseAudience = (value: Audience) => {
    setAudience(value);
    setSelected([]);
  };

  const toggleCustomer = (id: string) =>
    setSelected((current) =>
      audience === 'SINGLE_USER'
        ? [id]
        : current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
    );

  const send = async () => {
    if (!title.trim() || !content.trim()) {
      toast.showError('Complete the message', 'Title and message are required.');
      return;
    }
    if ((audience === 'SINGLE_USER' && selected.length !== 1) || (audience === 'MULTI_USER' && selected.length < 2) || (audience === 'ROLE_BASED' && roles.length === 0)) {
      toast.showError('Choose recipients');
      return;
    }
    setSending(true);
    try {
      await notificationsService.createStaffNotification({
        title: title.trim(),
        content: content.trim(),
        type,
        priority,
        targetType: audience,
        targetUsers: selected,
        ...(audience === 'ROLE_BASED' ? { targetRoles: roles } : {}),
      });
      setTitle('');
      setContent('');
      setSelected([]);
      setTab('history');
      toast.showSuccess('Notification sent');
      if (page === 1) await load();
      else setPage(1);
    } catch (sendError) {
      toast.showError('Unable to send notification', sendError instanceof Error ? sendError.message : undefined);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Broadcast"
        title="Notifications"
        subtitle="Customer notices"
        onBack={() => navigation.navigate('ManagementHome')}
        right={<StatusBadge label={`${history.length} sent`} />}
      />

      <View style={styles.tabs}>
        {(['history', 'compose'] as const).map((value) => (
          <AnimatedPressable key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabActive]}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {value === 'history' ? 'History' : 'Compose'}
            </Text>
          </AnimatedPressable>
        ))}
      </View>

      {loading ? (
        <NotificationSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : tab === 'history' ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={COLORS.gold} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          showsVerticalScrollIndicator={false}
        >
          <SectionTitle title="Delivery history" detail="Latest staff messages" />
          {history.length === 0 ? (
            <EmptyState icon="notifications-outline" title="No notifications sent" message="Messages sent by staff will appear here." accentColor={COLORS.gold} />
          ) : (
            <View style={styles.list}>
              {history.map((item, index) => (
                <FadeInView delay={Math.min(index * 35, 220)} key={item._id ?? item.id ?? `${item.createdAt}-${index}`}>
                  <OperationalRow
                    icon="notifications-outline"
                    meta={item.priority}
                    subtitle={`${item.content}\n${new Date(item.createdAt).toLocaleString('en-GB')}`}
                    title={item.title}
                    tone={priorityTone(item.priority)}
                  />
                </FadeInView>
              ))}
            </View>
          )}
          <View style={workflow.row}>
            {page > 1 ? <WorkflowChip onPress={() => setPage(page - 1)}>Previous page</WorkflowChip> : null}
            <Text style={workflow.body}>Page {page}</Text>
            {hasNext ? <WorkflowChip onPress={() => setPage(page + 1)}>Next page</WorkflowChip> : null}
          </View>
        </ScrollView>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <SectionTitle title="Audience" detail={audience === 'ALL_USERS' ? 'Whole system' : audience === 'ROLE_BASED' ? roles.join(', ') : `${selected.length} selected`} />
          <View style={styles.pills}>
            <AudiencePill label="Whole system" active={audience === 'ALL_USERS'} onPress={() => chooseAudience('ALL_USERS')} />
            <AudiencePill label="By role" active={audience === 'ROLE_BASED'} onPress={() => chooseAudience('ROLE_BASED')} />
            <AudiencePill label="One customer" active={audience === 'SINGLE_USER'} onPress={() => chooseAudience('SINGLE_USER')} />
            <AudiencePill label="Selected" active={audience === 'MULTI_USER'} onPress={() => chooseAudience('MULTI_USER')} />
          </View>

          {audience === 'ROLE_BASED' ? <View style={workflow.row}>
            {(['customer', 'staff', 'admin'] as const).map((role) => <WorkflowChip key={role} selected={roles.includes(role)} onPress={() => setRoles((current) => current.includes(role) ? current.filter((value) => value !== role) : [...current, role])}>{role}</WorkflowChip>)}
          </View> : null}
          {audience === 'SINGLE_USER' || audience === 'MULTI_USER' ? (
            <View style={styles.fieldGroup}>
              <TextInput value={search} onChangeText={setSearch} placeholder="Search customers" placeholderTextColor={COLORS.textMuted} style={styles.input} />
              <View style={styles.customerList}>
                {filtered.slice(0, 20).map((customer) => {
                  const active = selected.includes(customer._id);
                  return (
                    <AnimatedPressable key={customer._id} row onPress={() => toggleCustomer(customer._id)}>
                      <View style={[styles.customer, active && styles.customerActive]}>
                        <Ionicons name={active ? 'checkbox' : 'square-outline'} size={21} color={active ? COLORS.gold : COLORS.textMuted} />
                        <View style={styles.customerCopy}>
                          <Text style={styles.customerName}>{customer.profile?.fullName || customer.username || 'Customer'}</Text>
                          <Text style={styles.customerEmail}>{customer.email}</Text>
                        </View>
                      </View>
                    </AnimatedPressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <SectionTitle title="Priority" detail="Use operational colors consistently" />
          <View style={workflow.row}>{NOTIFICATION_TYPES.map((value) => <WorkflowChip key={value} selected={type === value} onPress={() => setType(value)}>{value}</WorkflowChip>)}</View>
          <View style={styles.pills}>
            {priorities.map((value) => (
              <AudiencePill key={value} label={value.toLowerCase()} active={priority === value} onPress={() => setPriority(value)} />
            ))}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder="Short, clear subject" placeholderTextColor={COLORS.textMuted} style={styles.input} />
            <Text style={styles.label}>Message</Text>
            <TextInput value={content} onChangeText={setContent} maxLength={2000} multiline placeholder="Write the message" placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.textarea]} />
          </View>

          <ActionButton disabled={sending} icon="send" label={sending ? 'Sending...' : 'Send notification'} loading={sending} onPress={send} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function AudiencePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </AnimatedPressable>
  );
}

function NotificationSkeleton() {
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <SkeletonBlock height={18} width="54%" />
          <SkeletonBlock height={14} width="80%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  tabs: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  tab: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  tabActive: { backgroundColor: 'rgba(226,186,75,0.12)', borderColor: COLORS.gold },
  tabText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, fontWeight: '900', textTransform: 'uppercase' },
  tabTextActive: { color: COLORS.gold },
  scroll: { gap: SPACING.md, padding: SPACING.lg, paddingBottom: 112 },
  list: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth },
  fieldGroup: { gap: SPACING.sm },
  label: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  pill: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: SPACING.md,
  },
  pillActive: { backgroundColor: 'rgba(226,186,75,0.1)', borderColor: COLORS.gold },
  pillText: { color: COLORS.textMuted, fontWeight: '800', textTransform: 'capitalize' },
  pillTextActive: { color: COLORS.gold },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    color: COLORS.textPrimary,
    minHeight: 52,
    paddingHorizontal: SPACING.md,
  },
  textarea: { height: 132, paddingTop: SPACING.md, textAlignVertical: 'top' },
  customerList: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: SPACING.sm },
  customer: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 62,
    paddingVertical: SPACING.sm,
  },
  customerActive: { backgroundColor: 'rgba(226,186,75,0.07)' },
  customerCopy: { flex: 1, minWidth: 0 },
  customerName: { color: COLORS.textPrimary, fontWeight: '800' },
  customerEmail: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  skeleton: { gap: SPACING.md, padding: SPACING.lg },
  skeletonRow: { gap: SPACING.sm, minHeight: 72 },
});
