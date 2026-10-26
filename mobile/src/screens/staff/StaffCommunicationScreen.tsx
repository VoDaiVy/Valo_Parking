import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/common';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { notificationsService } from '@/services/api/notifications';
import { operationsService, type NotificationRule } from '@/services/api/operations';

export function StaffCommunicationScreen({
  navigation,
}: NativeStackScreenProps<StaffManagementStackParamList, 'Communication'>) {
  const [tab, setTab] = useState<'report' | 'rules'>('report');
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'INFO' | 'WARNING' | 'ERROR'>('INFO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const loadRules = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await operationsService.getRules();
      setRules(response.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load rules.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (tab === 'rules') void loadRules();
  }, [tab]);
  const send = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await notificationsService.sendInternalReport(content.trim(), priority);
      setContent('');
      setSuccess('Internal report sent.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to send the report.');
    } finally {
      setBusy(false);
    }
  };
  const save = async (rule: NotificationRule) => {
    if (!Number.isInteger(rule.throttleMinutes) || rule.throttleMinutes < 1) {
      setError('The interval must be a whole number of minutes greater than zero.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await operationsService.updateRule(rule.eventKey, {
        enabled: rule.enabled,
        channels: rule.channels,
        throttleMinutes: rule.throttleMinutes,
      });
      if (response.data)
        setRules((items) =>
          items.map((item) => (item.eventKey === rule.eventKey ? response.data! : item)),
        );
      setSuccess('Notification rule saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save the rule.');
    } finally {
      setBusy(false);
    }
  };
  const edit = (key: string, update: Partial<NotificationRule>) =>
    setRules((items) =>
      items.map((item) => (item.eventKey === key ? { ...item, ...update } : item)),
    );
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader
        title="Internal communications"
        subtitle="Reports & automated notifications"
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.row}>
          <WorkflowChip selected={tab === 'report'} onPress={() => !busy && setTab('report')}>
            Internal reports
          </WorkflowChip>
          <WorkflowChip selected={tab === 'rules'} onPress={() => !busy && setTab('rules')}>
            Automation rules
          </WorkflowChip>
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        {success ? <Text style={s.body}>{success}</Text> : null}
        {tab === 'report' ? (
          <View style={s.panel}>
            <Text style={s.title}>Send a report to management</Text>
            <Text style={s.body}>Describe the issue, location and assistance needed.</Text>
            <TextInput
              accessibilityLabel="Report content"
              multiline
              editable={!busy}
              value={content}
              onChangeText={setContent}
              style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]}
              placeholder="Report content…"
              placeholderTextColor={COLORS.textMuted}
            />
            <View style={s.row}>
              {(['INFO', 'WARNING', 'ERROR'] as const).map((value) => (
                <WorkflowChip
                  key={value}
                  selected={priority === value}
                  onPress={() => !busy && setPriority(value)}
                >
                  {value}
                </WorkflowChip>
              ))}
            </View>
            <WorkflowButton
              title="Send report"
              disabled={busy || !content.trim()}
              onPress={() => void send()}
            />
          </View>
        ) : (
          <>
            <WorkflowChip onPress={() => !busy && void loadRules()}>Reload rules</WorkflowChip>
            {rules.map((rule) => (
              <View style={s.panel} key={rule.eventKey}>
                <Text style={s.body}>{rule.group}</Text>
                <Text style={s.title}>{rule.name}</Text>
                <WorkflowChip
                  selected={rule.enabled}
                  onPress={() => !busy && edit(rule.eventKey, { enabled: !rule.enabled })}
                >
                  {rule.enabled ? 'Enabled' : 'Disabled'}
                </WorkflowChip>
                <View style={s.row}>
                  {['In-app', 'Email', 'SMS', 'Push'].map((channel) => (
                    <WorkflowChip
                      key={channel}
                      selected={rule.channels.includes(channel)}
                      onPress={() =>
                        !busy &&
                        edit(rule.eventKey, {
                          channels: rule.channels.includes(channel)
                            ? rule.channels.filter((value) => value !== channel)
                            : [...rule.channels, channel],
                        })
                      }
                    >
                      {channel}
                    </WorkflowChip>
                  ))}
                </View>
                <Text style={s.body}>Minimum delivery interval (minutes)</Text>
                <TextInput
                  accessibilityLabel={`Delivery interval ${rule.name}`}
                  editable={!busy}
                  keyboardType="number-pad"
                  value={String(rule.throttleMinutes)}
                  onChangeText={(text) => edit(rule.eventKey, { throttleMinutes: Number(text) })}
                  style={s.input}
                />
                <WorkflowButton
                  title="Save rule"
                  disabled={busy}
                  onPress={() => void save(rule)}
                />
              </View>
            ))}
          </>
        )}
        {busy ? <ActivityIndicator color={COLORS.gold} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
