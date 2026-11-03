import { useLanguage } from '@/contexts/LanguageContext';
import { AppText, Card } from '@/components/common';
import { StyleSheet } from 'react-native';
import { Screen } from '@/components/layout/Screen';
import { colors, spacing } from '@/theme';

export const BookingsScreen = () => { const { t: translateUi } = useLanguage(); return (
  <Screen scrollable>
    <AppText variant="h1">{translateUi("Bookings")}</AppText>
    <Card style={styles.card}>
      <AppText variant="h3">{translateUi("Booking tools")}</AppText>
      <AppText color={colors.light.text.secondary}>{translateUi("Upcoming booking features will live here.")}</AppText>
    </Card>
  </Screen>
); };

const styles = StyleSheet.create({ card: { gap: spacing.md } });
