import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FadeInView,
  MetricStrip,
  OperationalMetric,
  OperationalRow,
  SectionTitle,
  StaffHeader,
  StatusBadge,
} from '@/components/staff';
import { COLORS, SPACING } from '@/constants/theme';
import { useStaffAssistant } from '@/contexts/StaffAssistantContext';
import { ValoAIMascot } from '@/components/staff/ValoAIMascot';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'ManagementHome'>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TOOLS: Array<{
  screen: Exclude<keyof StaffManagementStackParamList, 'ManagementHome'>;
  icon: IconName;
  title: string;
  description: string;
  meta: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}> = [
  { screen: 'StaffAssistant', icon: 'sparkles-outline', title: 'VALO AI assistant', description: 'Operational insights and suggested actions', meta: 'AI', tone: 'brand' },
  { screen: 'ParkingOperations', icon: 'construct-outline', title: 'Monitoring & maintenance', description: 'Violations, maintenance and parking history', meta: 'Operations', tone: 'warning' },
  { screen: 'Inbox', icon: 'mail-unread-outline', title: 'My inbox', description: 'Staff notifications', meta: 'Inbox', tone: 'info' },
  { screen: 'Communication', icon: 'chatbubbles-outline', title: 'Internal communications', description: 'Reports and automation rules', meta: 'Internal', tone: 'info' },
  { screen: 'Bookings', icon: 'qr-code-outline', title: 'Booking QR', description: 'Scan and inspect reservations', meta: 'Critical', tone: 'success' },
  { screen: 'Customers', icon: 'people-outline', title: 'Customers', description: 'Profiles and account access', meta: 'Support', tone: 'info' },
  { screen: 'Subscriptions', icon: 'diamond-outline', title: 'Memberships', description: 'Plans and reserved spaces', meta: 'Plans', tone: 'brand' },
  { screen: 'TicketPackages', icon: 'ticket-outline', title: 'Ticket packages', description: 'Parking plan catalog', meta: 'Catalog', tone: 'warning' },
  { screen: 'StaffNotifications', icon: 'notifications-outline', title: 'Notices', description: 'Customer messages', meta: 'Broadcast', tone: 'brand' },
];

export function ManagementHubScreen({ navigation }: Props) {
  const tabBarHeight = useBottomTabBarHeight();
  const { openAssistant } = useStaffAssistant();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Manage"
        title="Operations tools"
        subtitle="Staff workflows"
        right={<StatusBadge label="Staff" />}
      />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + SPACING.lg }]} showsVerticalScrollIndicator={false}>
        <FadeInView>
          <MetricStrip>
            <OperationalMetric icon="shield-checkmark-outline" label="Access" tone="success" value="Live" />
            <OperationalMetric icon="albums-outline" label="Modules" value={TOOLS.length} />
            <OperationalMetric icon="flash-outline" label="Mode" tone="warning" value="Ops" />
          </MetricStrip>
        </FadeInView>

        <FadeInView delay={70} style={styles.toolBlock}>
          <SectionTitle title="Tools" />
          <View style={styles.list}>
            {TOOLS.map((tool) => (
              <OperationalRow
                key={tool.screen}
                icon={tool.icon}
                iconElement={tool.screen === 'StaffAssistant' ? <ValoAIMascot size={38} /> : undefined}
                meta={tool.meta}
                subtitle={tool.description}
                title={tool.title}
                tone={tool.tone}
                onPress={() => tool.screen === 'StaffAssistant' ? openAssistant() : navigation.navigate(tool.screen)}
              />
            ))}
          </View>
        </FadeInView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scroll: { gap: SPACING.md, padding: SPACING.lg },
  toolBlock: { gap: SPACING.md },
  list: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth },
});
