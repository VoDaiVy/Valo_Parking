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
import { useLanguage } from '@/contexts/LanguageContext';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'ManagementHome'>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TOOLS: Array<{
  screen: Exclude<keyof StaffManagementStackParamList, 'ManagementHome'>;
  icon: IconName;
  titleKey: string;
  descriptionKey: string;
  metaKey: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}> = [
  { screen: 'BookingScanner', icon: 'qr-code-outline', titleKey: 'staffScanner', descriptionKey: 'staffScannerDesc', metaKey: 'critical', tone: 'success' },
  { screen: 'Bookings', icon: 'calendar-outline', titleKey: 'staffBookings', descriptionKey: 'staffBookingsDesc', metaKey: 'operations', tone: 'brand' },
  { screen: 'Customers', icon: 'people-outline', titleKey: 'staffCustomers', descriptionKey: 'staffCustomersDesc', metaKey: 'support', tone: 'info' },
  { screen: 'ParkingOperations', icon: 'construct-outline', titleKey: 'staffParkingOps', descriptionKey: 'staffParkingOpsDesc', metaKey: 'parking', tone: 'warning' },
  { screen: 'Inbox', icon: 'mail-unread-outline', titleKey: 'staffInbox', descriptionKey: 'staffInboxDesc', metaKey: 'inbox', tone: 'info' },
  { screen: 'Communication', icon: 'chatbubbles-outline', titleKey: 'staffCommunication', descriptionKey: 'staffCommunicationDesc', metaKey: 'internal', tone: 'info' },
];

export function ManagementHubScreen({ navigation }: Props) {
  const tabBarHeight = useBottomTabBarHeight();
  const { t } = useLanguage();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow={t('manage')}
        title={t('operationsTools')}
        subtitle={t('staffWorkflows')}
        right={<StatusBadge label={t('staff')} />}
      />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + SPACING.lg }]} showsVerticalScrollIndicator={false}>
        <FadeInView>
          <MetricStrip>
            <OperationalMetric icon="shield-checkmark-outline" label={t('access')} tone="success" value={t('live')} />
            <OperationalMetric icon="albums-outline" label={t('modules')} value={TOOLS.length} />
            <OperationalMetric icon="flash-outline" label={t('mode')} tone="warning" value={t('ops')} />
          </MetricStrip>
        </FadeInView>

        <FadeInView delay={70} style={styles.toolBlock}>
          <SectionTitle title={t('tools')} />
          <View style={styles.list}>
            {TOOLS.map((tool) => (
              <OperationalRow
                key={tool.screen}
                icon={tool.icon}
                meta={t(tool.metaKey)}
                subtitle={t(tool.descriptionKey)}
                title={t(tool.titleKey)}
                tone={tool.tone}
                onPress={() => navigation.navigate(tool.screen)}
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
