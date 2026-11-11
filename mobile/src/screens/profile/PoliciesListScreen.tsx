import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader, SectionTitle } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { ProfileStackParamList } from '@/navigation/types';
import { policiesService } from '@/services/api/policies';
import type { Policy, PolicyCategory } from '@/types/models';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Policies'>;

const CATEGORY_LABELS: Record<PolicyCategory, string> = {
  terms: 'Terms',
  privacy: 'Privacy',
  refund: 'Refunds',
  parking_rules: 'Parking rules',
  safety: 'Safety',
  other: 'Other',
};

const CATEGORY_ICON: Record<PolicyCategory, React.ComponentProps<typeof Ionicons>['name']> = {
  terms: 'document-text-outline',
  privacy: 'shield-checkmark-outline',
  refund: 'refresh-circle-outline',
  parking_rules: 'car-outline',
  safety: 'warning-outline',
  other: 'reader-outline',
};

export const PoliciesListScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await policiesService.listPublishedPolicies();
      setPolicies(response.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load policies.');
      setPolicies([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const grouped = useMemo(
    () =>
      policies.reduce<Record<string, Policy[]>>((acc, policy) => {
        const key = policy.category || 'other';
        acc[key] = [...(acc[key] || []), policy];
        return acc;
      }, {}),
    [policies],
  );

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={translateUi("Policies")}
        subtitle={`${policies.length} documents`}
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={load} />
      ) : policies.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={translateUi("No policies available")}
          message={translateUi("New policies will appear here.")}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />}
          showsVerticalScrollIndicator={false}
        >
          {Object.entries(grouped).map(([category, items]) => {
            const typedCategory = category as PolicyCategory;
            return (
              <View key={category} style={styles.group}>
                <SectionTitle>{CATEGORY_LABELS[typedCategory] || CATEGORY_LABELS.other}</SectionTitle>
                {items.map((policy) => {
                  const accepted = Boolean(policy.isAccepted || policy.acceptedAt);
                  const required = Boolean(policy.requiresAcceptance && !accepted);
                  return (
                    <Pressable
                      key={policy._id || policy.id || policy.slug}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.policyCard, pressed && { opacity: 0.88 }]}
                      onPress={() => navigation.navigate('PolicyDetail', { slug: policy.slug })}
                    >
                      <View style={styles.policyIcon}>
                        <Ionicons name={CATEGORY_ICON[typedCategory] || CATEGORY_ICON.other} size={22} color={COLORS.gold} />
                      </View>
                      <View style={styles.policyBody}>
                        <View style={styles.policyTop}>
                          <Text style={styles.policyTitle} numberOfLines={2}>
                            {policy.title}
                          </Text>
                          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                        </View>
                        {policy.description ? (
                          <Text style={styles.policyDescription} numberOfLines={2}>
                            {policy.description}
                          </Text>
                        ) : null}
                        <View style={styles.policyMeta}>
                          <Text style={styles.versionText}>
                            {" "}{translateUi("Version")}{" "}{policy.currentVersionNumber || policy.versionNumber || 'current'}
                          </Text>
                          {accepted ? (
                            <View style={[styles.statusPill, styles.statusAccepted]}>
                              <Text style={[styles.statusText, { color: COLORS.success }]}>{translateUi("Accepted")}</Text>
                            </View>
                          ) : required ? (
                            <View style={[styles.statusPill, styles.statusRequired]}>
                              <Text style={[styles.statusText, { color: COLORS.warning }]}>{translateUi("Review required")}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    gap: SPACING.lg,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  group: {
    gap: SPACING.sm,
  },
  policyCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  policyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: RADIUS.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  policyBody: {
    flex: 1,
    gap: 6,
  },
  policyTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  policyTitle: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
    lineHeight: 22,
  },
  policyDescription: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  policyMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },
  versionText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  statusPill: {
    borderRadius: RADIUS.round,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  statusAccepted: {
    backgroundColor: COLORS.successTint,
  },
  statusRequired: {
    backgroundColor: COLORS.warningTint,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
});
