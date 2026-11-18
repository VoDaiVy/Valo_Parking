import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  AppState,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { ScreenHeader } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/services/api/client';
import type { APIResponse } from '@/types/api';
import { COLORS } from '@/constants/theme';
import { useSocket } from '@/hooks/useSocket';
import { useLanguage } from '@/contexts/LanguageContext';
import { isMembershipServiceNotification } from '@/utils/notifications';
import type { UserNotification } from '@/types/models';

interface Grant {
  _id: string;
  serviceId: string;
  serviceName: string;
  slotCode: string;
  total: number;
  reserved: number;
  used: number;
  available: number;
  canUse: boolean;
  validFrom: string;
  expireAt: string;
}
interface ServiceRequest {
  accountingMode?: string;
  startedAt?: string;
  completedAt?: string;
  _id: string;
  serviceId?: string;
  grantId?: string;
  serviceName: string;
  slotCode: string;
  licensePlate: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  history: Array<{ reason?: string }>;
}
interface ParkingSession {
  _id: string;
  licensePlate: string;
  parkingSlot?: string;
}
interface Page<T> {
  items: T[];
  pagination: { totalPages?: number; total?: number };
}
interface Benefits {
  grants: Grant[] | Page<Grant>;
  requests: ServiceRequest[] | Page<ServiceRequest>;
}
const pageData = <T,>(data?: T[] | Page<T>): Page<T> =>
  Array.isArray(data) ? { items: data, pagination: {} } : data || { items: [], pagination: {} };

export function MembershipServicesScreen({ navigation, route }: { navigation: { goBack: () => void }; route?: { params?: { sessionId?: string; requestId?: string } } }) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const socket = useSocket();
  const [status, setStatus] = useState('');
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const staff = user?.role === 'staff' || user?.role === 'admin';
  const [grants, setGrants] = useState<Page<Grant>>(pageData());
  const [requests, setRequests] = useState<Page<ServiceRequest>>(pageData());
  const [sessions, setSessions] = useState<Page<ParkingSession>>(pageData());
  const [sessionId, setSessionId] = useState(route?.params?.sessionId || '');
  const linkedRequestId = sessionId === route?.params?.sessionId ? route?.params?.requestId : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [grantPage, setGrantPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [legacyUses, setLegacyUses] = useState(0);
  const keys = useRef<Record<string, string>>({});
  const inFlight = useRef(false);
  useEffect(() => { setSessionId(route?.params?.sessionId || ''); setStatus(''); setRequestPage(1); }, [route?.params?.sessionId, route?.params?.requestId]);

  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (inFlight.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => setReload((value) => value + 1), 350);
    };
    const receive = (payload: unknown) => { if (isMembershipServiceNotification(payload as UserNotification)) refresh(); };
    socket.on('notification:new', receive);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearTimeout(timer); socket.off('notification:new', receive); appState.remove(); };
  }, [socket]));

  useFocusEffect(useCallback(() => {
    if (!staff) return;
    let active = true;
    void Promise.all(['', 'pending', 'in_progress', 'done'].map(async (value) => {
      const response = await apiClient.get<APIResponse<Page<ServiceRequest>>>(`/membership-services/requests?page=1&limit=1${value ? `&status=${value}` : ''}`);
      if (!response.success || !Number.isFinite(response.data?.pagination.total)) throw new Error('Metrics unavailable');
      return response.data!.pagination.total!;
    })).then(([total, pending, in_progress, done]) => { if (active) setMetrics({ total, pending, in_progress, done }); })
      .catch(() => { if (active) setMetrics(null); });
    return () => { active = false; };
  }, [staff, reload]));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const get = async <T,>(path: string) => {
        const response = await apiClient.get<APIResponse<T>>(`/membership-services/${path}`);
        if (!response.success || !response.data)
          throw new Error(response.message || 'Unable to load services.');
        return response.data;
      };
      const load = async () => {
        setLoading(true);
        setError('');
        try {
          if (staff) {
            const [sessionData, benefits, history] = await Promise.all([
              get<ParkingSession[] | Page<ParkingSession>>(
                `staff/sessions?page=${sessionPage}&search=${encodeURIComponent(search)}`,
              ),
              sessionId ? get<Benefits>(`staff/sessions/${sessionId}/benefits${linkedRequestId ? `?requestId=${encodeURIComponent(linkedRequestId)}` : ''}`) : null,
              sessionId ? null : get<Page<ServiceRequest>>(`requests?page=${requestPage}${status ? `&status=${status}` : ''}`),
            ]);
            if (!active) return;
            setSessions(pageData(sessionData));
            setGrants(pageData(benefits?.grants));
            setRequests(pageData(benefits?.requests || history || undefined));
          } else {
            const [grantData, requestData, membership] = await Promise.all([
              get<Page<Grant>>(`grants?page=${grantPage}`),
              sessionId ? get<Benefits>(`sessions/${sessionId}/benefits`).then((data) => pageData(data.requests)) : get<Page<ServiceRequest>>(`requests?page=${requestPage}${status ? `&status=${status}` : ''}`),
              apiClient.get<APIResponse<{ freeServiceCount: number }>>('/subscriptions/membership'),
            ]);
            if (!active) return;
            setGrants(grantData);
            setRequests(requestData);
            if (membership.success && membership.data)
              setLegacyUses(Number(membership.data.freeServiceCount || 0));
          }
          setSelected([]);
        } catch (loadError) {
          if (active) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load services.');
            setGrants(pageData());
            setRequests(pageData());
            setSelected([]);
          }
        } finally {
          if (active) setLoading(false);
        }
      };
      void load();
      return () => {
        active = false;
      };
    }, [staff, grantPage, requestPage, sessionPage, sessionId, search, status, reload, linkedRequestId, socket.isConnected]),
  );

  const mutate = async (path: string, payload: Record<string, string | string[]>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await apiClient.post<APIResponse>(`/membership-services/${path}`, payload);
      if (!response.success) throw new Error(response.message || 'Unable to update service work.');
      setReason('');
      setReload((value) => value + 1);
      return true;
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : 'Unable to update service work.',
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const start = async () => {
    const grantIds = [...selected].sort();
    const signature = JSON.stringify([sessionId, grantIds]);
    keys.current[signature] ||= Crypto.randomUUID();
    if (
      await mutate('staff/start', { sessionId, grantIds, idempotencyKey: keys.current[signature] })
    )
      delete keys.current[signature];
  };
  const cancel = (request: ServiceRequest) =>
    Alert.alert(
      t('Cancel service'),
      t('Cancel this service work? Any returned allowance keeps its original expiry.'),
      [
        { text: t('Back'), style: 'cancel' },
        {
          text: t('Confirm'),
          onPress: () => {
            void mutate(`requests/${request._id}/cancel`, { reason });
          },
        },
      ],
    );
  const toggle = (grant: Grant) =>
    setSelected((current) =>
      current.includes(grant._id)
        ? current.filter((value) => value !== grant._id)
        : [
            ...current.filter(
              (value) =>
                grants.items.find((item) => item._id === value)?.serviceId !== grant.serviceId,
            ),
            grant._id,
          ],
    );
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      style={[styles.button, (busy || disabled) && styles.disabled]}
    >
      <Text style={styles.buttonText}>{t(label)}</Text>
    </Pressable>
  );
  const pages = (page: number, data: Page<unknown>, setPage: (page: number) => void) => (
    <View style={styles.row}>
      {page > 1 && button('Previous', () => setPage(page - 1), loading)}
      {page < (data.pagination.totalPages || 0) && button('More', () => setPage(page + 1), loading)}
    </View>
  );

  const visibleRequests = requests.items.filter((request) => !sessionId || !status || request.status === status);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader title="Membership services" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {staff && <View style={styles.row}>{[['total', 'Total services'], ['pending', 'Pending approval'], ['in_progress', 'In progress'], ['done', 'Completed']].map(([key, label]) => <View key={key} style={styles.metric}><Text style={styles.text}>{t(label)}</Text><Text style={styles.title}>{metrics?.[key] ?? '—'}</Text></View>)}</View>}
        <View style={styles.row}>{[['', 'All'], ['pending', 'Pending approval'], ['in_progress', 'In progress'], ['done', 'Completed'], ['cancelled', 'Cancelled']].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: status === value }} disabled={busy || loading} onPress={() => { setStatus(value); setRequestPage(1); }} style={[styles.vehicle, status === value && styles.selected]}><Text style={styles.text}>{t(label)}</Text></Pressable>)}</View>
        {button('Refresh', () => setReload((value) => value + 1), loading)}
        {!staff && !!sessionId && button('Show all service history', () => { setSessionId(''); setStatus(''); setRequestPage(1); })}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(error)}
          </Text>
        )}
        {staff && (
          <>
            <Text style={styles.title}>{t("Vehicles currently parked")}</Text>
            <TextInput
              accessibilityLabel="Find license plate"
              value={search}
              editable={!busy}
              onChangeText={(value) => {
                setSearch(value);
                setSessionPage(1);
              }}
              placeholder={t('Find license plate')}
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
            />
            <View style={styles.row}>
              {sessions.items.map((session) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: sessionId === session._id }}
                  disabled={busy || loading}
                  key={session._id}
                  onPress={() => {
                    setSessionId(session._id);
                    setSelected([]);
                    setReason('');
                  }}
                  style={[styles.vehicle, sessionId === session._id && styles.selected]}
                >
                  <Text style={styles.text}>
                    {session.licensePlate} {session.parkingSlot ? `· ${session.parkingSlot}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!loading && !sessions.items.length && (
              <Text style={styles.text}>{t("No matching vehicles currently parked.")}</Text>
            )}
            {pages(sessionPage, sessions, setSessionPage)}
            {!!sessionId &&
              button('Show all service history', () => {
                setSessionId('');
                setSelected([]);
              })}
          </>
        )}
        {loading ? (
          <ActivityIndicator color={COLORS.gold} />
        ) : (
          <>
            {(!staff || !!sessionId) && (
              <>
                <Text style={styles.text}>
                  {staff
                    ? t('Select services to start. Each service uses 1 allowance and can be completed independently.')
                    : t('Ask staff at the parking lot to start an included service. Track remaining uses and history here.')}
                </Text>
                {!grants.items.length && (
                  <Text style={styles.text}>{t("No service allowances issued for these spaces.")}</Text>
                )}
                {!staff && !grants.pagination.total && legacyUses > 0 && (
                  <Text style={styles.text}>
                    Your earlier membership records {legacyUses} service uses. Contact staff to
                    identify the included services.
                  </Text>
                )}
                {grants.items.map((grant) => {
                  const running = requests.items.some(
                    (request) =>
                      ['pending', 'in_progress'].includes(request.status) &&
                      (request.serviceId === grant.serviceId || request.grantId === grant._id),
                  );
                  return (
                    <View key={grant._id} style={styles.card}>
                      <Text style={styles.title}>
                        {grant.serviceName} · {grant.slotCode}
                      </Text>
                      <Text style={styles.text}>
                        {t('Granted')} {grant.total} · {t('Used')} {grant.used} · {t('Reserved')} {grant.reserved} ·
                        {t('Remaining')} {grant.available}
                      </Text>
                      <Text style={styles.text}>
                        {new Date(grant.validFrom).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-GB')} –{' '}
                        {new Date(grant.expireAt).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-GB')}
                      </Text>
                      {staff && (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked: selected.includes(grant._id),
                            disabled: busy || !grant.canUse || running,
                          }}
                          disabled={busy || !grant.canUse || running}
                          onPress={() => toggle(grant)}
                          style={[
                            styles.vehicle,
                            selected.includes(grant._id) && styles.selected,
                            (!grant.canUse || running) && styles.disabled,
                          ]}
                        >
                          <Text style={styles.text}>
                            {running
                              ? t('In progress')
                              : selected.includes(grant._id)
                                ? '✓ Selected'
                                : t('Select service')}
                          </Text>
                        </Pressable>
                      )}
                      {!grant.canUse && (
                        <Text style={styles.text}>{t("Unavailable: check remaining uses, service period and membership status.")}</Text>
                      )}
                    </View>
                  );
                })}
                {staff
                  ? button(
                      `${t('Start selected services')} (${selected.length})`,
                      () => {
                        void start();
                      },
                      !selected.length,
                    )
                  : pages(grantPage, grants, setGrantPage)}
              </>
            )}
            <Text style={styles.title}>
              {t(staff && sessionId ? 'Active work and recent history' : 'Service work and history')}
            </Text>
            {staff && !!sessionId && (
              <Text style={styles.text}>{t("All active services and up to 100 completed or cancelled services.")}</Text>
            )}
            {staff && (
              <TextInput
                accessibilityLabel="Cancellation reason"
                value={reason}
                onChangeText={setReason}
                placeholder={t('Reason for cancelling service')}
                placeholderTextColor={COLORS.textMuted}
                style={styles.input}
                editable={!busy}
                maxLength={500}
              />
            )}
            {!visibleRequests.length && <Text style={styles.text}>{t("No service work yet.")}</Text>}
            {visibleRequests.map((request) => (
              <View key={request._id} accessibilityLabel={linkedRequestId === request._id ? t('Selected service request') : undefined} style={[styles.card, linkedRequestId === request._id && styles.selected]}>
                <Text style={styles.title}>
                  {request.serviceName} · {request.slotCode}
                </Text>
                <Text style={styles.text}>
                  {request.licensePlate} · {t(({ pending: 'Pending approval', in_progress: 'In progress', done: 'Completed', cancelled: 'Cancelled' })[request.status])}
                </Text>
                {!!request.startedAt && (
                  <Text style={styles.text}>
                    {t('Started')} {new Date(request.startedAt).toLocaleString('vi-VN')}
                  </Text>
                )}
                {!!request.completedAt && (
                  <Text style={styles.text}>
                    {t('Completed')} {new Date(request.completedAt).toLocaleString('vi-VN')}
                  </Text>
                )}
                {!!request.history?.at(-1)?.reason && (
                  <Text style={styles.text}>{request.history.at(-1)?.reason}</Text>
                )}
                {staff && (
                  <View style={styles.row}>
                    {request.status === 'pending' && (
                      request.accountingMode === 'customer_reserved' ? button('Start service', () => void mutate(`requests/${request._id}/start`, {}), loading) : <Text style={styles.text}>{t("Cancel this earlier request, then start the service from the active parking session.")}</Text>
                    )}
                    {request.status === 'in_progress' &&
                      button('Complete this service', () => {
                        void mutate(`requests/${request._id}/complete`, {});
                      })}
                    {['pending', 'in_progress'].includes(request.status) &&
                      button(
                        'Cancel',
                        () => cancel(request),
                        (request.status === 'in_progress' || request.accountingMode === 'customer_reserved') && !reason.trim(),
                      )}
                  </View>
                )}
              </View>
            ))}
            {(!staff || !sessionId) && pages(requestPage, requests, setRequestPage)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  metric: { flexGrow: 1, flexBasis: '40%', padding: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12 },
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  card: { padding: 18, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12 },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  text: { color: COLORS.textSecondary, lineHeight: 22 },
  error: { color: COLORS.error },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: {
    minHeight: 44,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.gold,
    justifyContent: 'center',
  },
  buttonText: { color: COLORS.textInverse, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  vehicle: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
  },
  selected: { borderColor: COLORS.gold },
  input: {
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    borderRadius: 12,
  },
});
