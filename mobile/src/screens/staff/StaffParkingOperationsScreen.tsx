import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorState, ScreenHeader } from '@/components/common';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import { useAppAlert } from '@/contexts/AppAlertContext';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { operationsService, type SlotAuditLog } from '@/services/api/operations';
import parkingFloorService from '@/services/ParkingFloorService';
import type { ParkingFloor, Slot } from '@/types/booking.types';
import { formatDate } from '@/utils/formatters';

export function StaffParkingOperationsScreen({
  navigation,
}: NativeStackScreenProps<StaffManagementStackParamList, 'ParkingOperations'>) {
  const [tab, setTab] = useState<'violations' | 'maintenance'>('violations');
  const [logs, setLogs] = useState<SlotAuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [floors, setFloors] = useState<ParkingFloor[]>([]);
  const [floorId, setFloorId] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [slotLogs, setSlotLogs] = useState<SlotAuditLog[]>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { alert } = useAppAlert();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'violations') {
        const response = await operationsService.getViolations({
          page,
          search: query || undefined,
          status: pendingOnly ? 'PENDING' : undefined,
        });
        setLogs(response.data || []);
        setPages(response.totalPages || 1);
      } else {
        setFloors(await parkingFloorService.getParkingFloors());
        if (floorId) setSlots(await parkingFloorService.getSlotsByFloor(floorId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load operational data.');
    } finally {
      setLoading(false);
    }
  }, [tab, page, query, pendingOnly, floorId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSlotLogs([]);
    if (!selected || !floorId) return;
    let active = true;
    void operationsService
      .getSlotLogs(selected.slotNumber || selected.slotCode, floorId)
      .then((response) => {
        if (active) setSlotLogs(response.data || []);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load space history.');
      });
    return () => {
      active = false;
    };
  }, [selected, floorId]);
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      setSelected(null);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update.');
    } finally {
      setBusy(false);
    }
  };
  const maintain = () => {
    const id = selected?._id || selected?.id;
    if (!id || !selected) return;
    const ending = selected.status === 'maintenance';
    alert(
      ending ? 'End maintenance?' : 'Start maintenance for this space?',
      `${selected.slotNumber || selected.slotCode}${ending ? '' : ` · ${reason}`}`,
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () =>
            act(() =>
              ending
                ? operationsService.endMaintenance(id)
                : operationsService.startMaintenance(id, reason.trim()),
            ),
        },
      ],
    );
  };
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader
        title="Monitoring & maintenance"
        subtitle="Violations, history and parking space status"
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.row}>
          <WorkflowChip
            selected={tab === 'violations'}
            onPress={() => !busy && setTab('violations')}
          >
            Violations
          </WorkflowChip>
          <WorkflowChip
            selected={tab === 'maintenance'}
            onPress={() => !busy && setTab('maintenance')}
          >
            Maintenance & space history
          </WorkflowChip>
        </View>
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {tab === 'violations' ? (
          <>
            <TextInput
              accessibilityLabel="Search by license plate or space"
              placeholder="Search plates or spaces…"
              placeholderTextColor={COLORS.textMuted}
              style={s.input}
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => {
                setPage(1);
                setQuery(search.trim());
              }}
            />
            <View style={s.row}>
              <WorkflowChip
                onPress={() => {
                  setPage(1);
                  setQuery(search.trim());
                }}
              >
                Search
              </WorkflowChip>
              <WorkflowChip
                selected={pendingOnly}
                onPress={() => {
                  setPage(1);
                  setPendingOnly(!pendingOnly);
                }}
              >
                {pendingOnly ? 'Pending' : 'All statuses'}
              </WorkflowChip>
            </View>
            {logs.map((log) => (
              <View style={s.panel} key={log._id}>
                <Text style={s.title}>
                  {log.slotCode} · {log.detectedPlate || 'Unidentified plate'}
                </Text>
                <Text style={s.body}>
                  {log.status} · {formatDate(log.createdAt)}
                </Text>
                <Text style={s.body}>
                  {log.violationMessage || log.resolutionNote || log.changeType}
                </Text>
                {log.status === 'PENDING' ? (
                  <WorkflowButton
                    title="Record driver warning"
                    disabled={busy}
                    onPress={() =>
                      alert(
                        'Record this warning?',
                        `Space ${log.slotCode} · ${log.detectedPlate || ''}`,
                        [
                          { text: 'Back', style: 'cancel' },
                          {
                            text: 'Confirm',
                            onPress: () =>
                              act(() =>
                                operationsService.resolveViolation({
                                  logId: log._id,
                                  slotCode: log.slotCode,
                                  floorId:
                                    typeof log.floorId === 'object' ? log.floorId._id : log.floorId,
                                  action: 'ISSUE_WARNING',
                                  note: 'Staff issued a warning at the parking facility.',
                                }),
                              ),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
              </View>
            ))}
            {!loading && !logs.length ? (
              <Text style={s.body}>No matching violations.</Text>
            ) : null}
            <View style={s.row}>
              {page > 1 ? (
                <WorkflowChip onPress={() => setPage(page - 1)}>Previous page</WorkflowChip>
              ) : null}
              <Text style={s.body}>
                {page}/{pages}
              </Text>
              {page < pages ? (
                <WorkflowChip onPress={() => setPage(page + 1)}>Next page</WorkflowChip>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={s.row}>
              {floors.map((floor) => (
                <WorkflowChip
                  key={floor._id}
                  selected={floorId === floor._id}
                  onPress={() => {
                    if (!busy) {
                      setFloorId(floor._id);
                      setSlots([]);
                      setSelected(null);
                    }
                  }}
                >
                  {floor.name}
                </WorkflowChip>
              ))}
            </View>
            <View style={s.row}>
              {slots.map((slot) => (
                <WorkflowChip
                  key={slot._id || slot.id}
                  selected={selected === slot}
                  onPress={() => !busy && setSelected(slot)}
                >
                  {slot.slotNumber || slot.slotCode} · {slot.status}
                </WorkflowChip>
              ))}
            </View>
            {selected ? (
              <View style={s.panel}>
                <Text style={s.title}>Space {selected.slotNumber || selected.slotCode}</Text>
                <Text style={s.body}>{selected.status}</Text>
                <TextInput
                  accessibilityLabel="Reason for maintenance"
                  placeholder="Reason for maintenance"
                  placeholderTextColor={COLORS.textMuted}
                  style={s.input}
                  value={reason}
                  onChangeText={setReason}
                />
                <WorkflowButton
                  title={selected.status === 'maintenance' ? 'End maintenance' : 'Start maintenance'}
                  disabled={
                    busy ||
                    (selected.status !== 'maintenance' &&
                      (selected.status !== 'available' || !reason.trim()))
                  }
                  onPress={maintain}
                />
                <Text style={s.title}>Space history</Text>
                {slotLogs.map((log) => (
                  <Text key={log._id} style={s.body}>
                    {formatDate(log.createdAt)} · {log.resolutionNote || log.changeType}
                  </Text>
                ))}
                {!slotLogs.length ? <Text style={s.body}>No history yet.</Text> : null}
              </View>
            ) : (
              <Text style={s.body}>Select a floor and space to view history or manage maintenance.</Text>
            )}
          </>
        )}
        {loading || busy ? <ActivityIndicator color={COLORS.gold} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
