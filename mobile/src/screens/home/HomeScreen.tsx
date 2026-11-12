import { useLanguage } from '@/contexts/LanguageContext';
import { Card, AppText } from '@/components/common';
import { StyleSheet } from 'react-native';
import { Screen } from '@/components/layout/Screen';
import { useAuth } from '@/hooks/useAuth';
import { colors, spacing } from '@/theme';

export const HomeScreen = () => {
  const { t: translateUi } = useLanguage();
  const { user } = useAuth();

  return (
    <Screen scrollable>
      <AppText variant="h1">{translateUi("Home")}</AppText>
      <Card style={styles.card}>
        <AppText variant="h3">{translateUi("Hello,")}{" "}{user?.username || translateUi("Customer")}</AppText>
        <AppText color={colors.light.text.secondary}>{translateUi("Your parking account is ready.")}</AppText>
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({ card: { gap: spacing.md } });
