import { useLanguage } from '@/contexts/LanguageContext';
import { StyleSheet } from 'react-native';

import { AppText, Card } from '@/components/common';
import { colors, spacing } from '@/theme';
import type { UserMembership } from '@/types/models';

export const MembershipBadge = ({ membership }: { membership?: UserMembership }) => {
  const { t: translateUi } = useLanguage();
  if (!membership?.isVip) return null;
  return (
    <Card style={styles.card}>
      <AppText color={colors.primary[600]} variant="h3">{translateUi("VIP Membership")}</AppText>
      <AppText color={colors.light.text.secondary} variant="body2">{translateUi("Expires:")}{" "}{membership.expireAt ? new Date(membership.expireAt).toLocaleDateString('en-GB') : 'N/A'}</AppText>
      <AppText variant="body2">{membership.freeServiceCount || 0} {" "}{translateUi("free services remaining")}</AppText>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary[50],
    gap: spacing.sm,
  },
});

