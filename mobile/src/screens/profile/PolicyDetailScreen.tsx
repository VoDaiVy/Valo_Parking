import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useToast } from '@/hooks/useToast';
import type { ProfileStackParamList } from '@/navigation/types';
import { policiesService } from '@/services/api/policies';
import type { PolicyCategory, PolicyDetail } from '@/types/models';
import { hasReviewedPolicy } from '@/utils/policyReview';

type Props = NativeStackScreenProps<ProfileStackParamList, 'PolicyDetail'>;

const CATEGORY_LABELS: Record<PolicyCategory, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  refund: 'Refund policy',
  parking_rules: 'Parking rules',
  safety: 'Safety policy',
  other: 'VALO policy',
};

const formatDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-GB');
};

export const PolicyDetailScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setContentHeight(0);
    setViewportHeight(0);
    setScrollOffset(0);
    try {
      const response = await policiesService.getPolicyBySlug(route.params.slug);
      setPolicy(response.data || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load policy details.');
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, [route.params.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const accepted = Boolean(policy?.isAccepted || policy?.acceptedAt);
  const requiresAcceptance = Boolean(policy?.requiresAcceptance && !accepted);
  const reviewed = hasReviewedPolicy({ contentHeight, viewportHeight, scrollOffset });

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollOffset(event.nativeEvent.contentOffset.y);
  };

  const accept = async () => {
    if (!policy || !reviewed || accepting) return;
    const id = policy._id || policy.id;
    if (!id) {
      toast.showError('The policy ID is missing.');
      return;
    }

    setAccepting(true);
    try {
      await policiesService.acceptPolicy(id);
      const acceptedAt = new Date().toISOString();
      setPolicy({ ...policy, isAccepted: true, acceptedAt });
      toast.showSuccess('Policy accepted');
    } catch (acceptError) {
      toast.showError(acceptError instanceof Error ? acceptError.message : 'Unable to accept the policy.');
    } finally {
      setAccepting(false);
    }
  };

  const version = policy?.currentVersionNumber || policy?.versionNumber || 'current';
  const publishedDate = formatDate(policy?.currentVersion?.effectiveDate || policy?.publishedAt);
  const categoryLabel = policy ? CATEGORY_LABELS[policy.category] || CATEGORY_LABELS.other : '';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader title={translateUi("Policy details")} onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
          <Text style={styles.loadingText}>{translateUi("Loading document...")}</Text>
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={load} />
      ) : !policy ? (
        <EmptyState
          icon="document-text-outline"
          title={translateUi("Policy not found")}
          message={translateUi("This document may have changed or is no longer published.")}
        />
      ) : (
        <>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            scrollEventThrottle={32}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={(_, height) => setContentHeight(height)}
            onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
            onScroll={handleScroll}
          >
            <View style={styles.documentHeader}>
              <LinearGradient
                colors={['rgba(212,175,55,0.20)', 'rgba(212,175,55,0.02)']}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.headerTopRow}>
                <View style={styles.documentIcon}>
                  <Ionicons name="document-text-outline" size={25} color={COLORS.goldLight} />
                </View>
                <View
                  style={[
                    styles.statusPill,
                    accepted ? styles.statusAccepted : styles.statusRequired,
                  ]}
                >
                  <Ionicons
                    name={accepted ? 'checkmark-circle' : 'alert-circle'}
                    size={14}
                    color={accepted ? COLORS.success : COLORS.warning}
                  />
                  <Text style={[styles.statusText, { color: accepted ? COLORS.success : COLORS.warning }]}>
                    {accepted ? translateUi("Accepted") : policy.requiresAcceptance ? translateUi("Acceptance required") : translateUi("For reference")}
                  </Text>
                </View>
              </View>

              <Text style={styles.eyebrow}>{categoryLabel}</Text>
              <Text style={styles.title}>{policy.title}</Text>
              {policy.description ? <Text style={styles.summary}>{policy.description}</Text> : null}

              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Ionicons name="layers-outline" size={14} color={COLORS.textSecondary} />
                  <Text style={styles.metaText}>{translateUi("Version")}{" "}{version}</Text>
                </View>
                {publishedDate ? (
                  <View style={styles.metaChip}>
                    <Ionicons name="calendar-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{translateUi("Effective")}{" "}{publishedDate}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Ionicons name="reader-outline" size={18} color={COLORS.gold} />
              </View>
              <View style={styles.sectionHeadingText}>
                <Text style={styles.sectionTitle}>{translateUi("Policy content")}</Text>
                <Text style={styles.sectionSubtitle}>{translateUi("Please read carefully before accepting")}</Text>
              </View>
            </View>

            <View style={styles.contentCard}>
              <Text selectable style={styles.contentText}>{policy.content || translateUi("Content is being updated.")}</Text>
            </View>

            {policy.versionHistory?.length ? (
              <View style={styles.historySection}>
                <Text style={styles.historyTitle}>{translateUi("Version history")}</Text>
                {policy.versionHistory.map((item, index) => (
                  <View key={`${item.versionNumber}-${index}`} style={styles.versionRow}>
                    <View style={styles.timelineColumn}>
                      <View style={styles.versionDot} />
                      {index < policy.versionHistory!.length - 1 ? <View style={styles.timelineLine} /> : null}
                    </View>
                    <View style={styles.versionBody}>
                      <View style={styles.versionTopRow}>
                        <Text style={styles.versionTitle}>{translateUi("Version")}{" "}{item.versionNumber}</Text>
                        {index === 0 ? <Text style={styles.latestLabel}>{translateUi("LATEST")}</Text> : null}
                      </View>
                      <Text style={styles.versionMeta}>{item.changeSummary || 'Published'}</Text>
                      {formatDate(item.publishedAt) ? (
                        <Text style={styles.versionDate}>{formatDate(item.publishedAt)}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {accepted ? (
              <View style={styles.acceptedBox}>
                <View style={styles.acceptedIcon}>
                  <Ionicons name="checkmark" size={20} color={COLORS.success} />
                </View>
                <View style={styles.acceptedBody}>
                  <Text style={styles.acceptedTitle}>{translateUi("You accepted this policy")}</Text>
                  {policy.acceptedAt ? (
                    <Text style={styles.acceptedText}>{translateUi("Accepted on")}{" "}{formatDate(policy.acceptedAt)}</Text>
                  ) : null}
                </View>
              </View>
            ) : requiresAcceptance ? (
              <View style={[styles.reviewHint, reviewed && styles.reviewHintReady]}>
                <Ionicons
                  name={reviewed ? 'checkmark-circle-outline' : 'arrow-down-circle-outline'}
                  size={20}
                  color={reviewed ? COLORS.success : COLORS.gold}
                />
                <Text style={[styles.reviewHintText, reviewed && styles.reviewHintTextReady]}>
                  {reviewed ? translateUi("You have reviewed the full document and can now accept it.") : translateUi("Scroll to the end of the document to enable acceptance.")}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {requiresAcceptance ? (
            <View style={styles.footer}>
              <Text style={styles.footerHint}>
                {reviewed ? translateUi("By accepting, you confirm that you have read this policy.") : translateUi("Read the full document to continue")}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: !reviewed || accepting }}
                activeOpacity={0.85}
                disabled={!reviewed || accepting}
                style={[styles.acceptButton, (!reviewed || accepting) && styles.acceptButtonDisabled]}
                onPress={() => void accept()}
              >
                {accepting ? (
                  <ActivityIndicator color={COLORS.textInverse} size="small" />
                ) : (
                  <>
                    <Ionicons
                      name={reviewed ? 'checkmark-circle' : 'lock-closed'}
                      size={20}
                      color={reviewed ? COLORS.textInverse : COLORS.textMuted}
                    />
                    <Text style={[styles.acceptButtonText, !reviewed && styles.acceptButtonTextDisabled]}>
                      {reviewed ? translateUi("I accept this policy") : translateUi("Finish reading to continue")}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  stateWrap: { alignItems: 'center', flex: 1, gap: SPACING.md, justifyContent: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  scrollView: { flex: 1 },
  scrollContent: {
    gap: SPACING.lg,
    paddingBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  documentHeader: {
    borderColor: 'rgba(212,175,55,0.28)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.sm,
    overflow: 'hidden',
    padding: SPACING.lg,
  },
  headerTopRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'space-between', marginBottom: SPACING.sm },
  documentIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderRadius: RADIUS.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  statusPill: { alignItems: 'center', borderRadius: RADIUS.round, flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingVertical: 6 },
  statusAccepted: { backgroundColor: COLORS.successTint },
  statusRequired: { backgroundColor: COLORS.warningTint },
  statusText: { fontSize: FONT_SIZES.xs, fontWeight: '800' },
  eyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.xs, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '900', lineHeight: 34 },
  summary: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, lineHeight: 21 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  metaChip: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.round, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  metaText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: SPACING.sm },
  sectionIcon: { alignItems: 'center', backgroundColor: 'rgba(212,175,55,0.10)', borderRadius: RADIUS.sm, height: 38, justifyContent: 'center', width: 38 },
  sectionHeadingText: { flex: 1 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '800' },
  sectionSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  contentCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.lg },
  contentText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, lineHeight: 28 },
  historySection: { gap: 0 },
  historyTitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '800', letterSpacing: 1, marginBottom: SPACING.md, textTransform: 'uppercase' },
  versionRow: { flexDirection: 'row', gap: SPACING.md, minHeight: 64 },
  timelineColumn: { alignItems: 'center', width: 12 },
  versionDot: { backgroundColor: COLORS.gold, borderRadius: 5, height: 10, marginTop: 5, width: 10 },
  timelineLine: { backgroundColor: COLORS.borderLight, flex: 1, marginVertical: 4, width: 1 },
  versionBody: { flex: 1, paddingBottom: SPACING.md },
  versionTopRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  versionTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  latestLabel: { color: COLORS.gold, fontSize: FONT_SIZES.xs, lineHeight: 16, fontWeight: '600' },
  versionMeta: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, lineHeight: 18, marginTop: 4 },
  versionDate: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  reviewHint: { alignItems: 'center', backgroundColor: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.20)', borderRadius: RADIUS.md, borderWidth: 1, flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md },
  reviewHintReady: { backgroundColor: COLORS.successTint, borderColor: COLORS.success },
  reviewHintText: { color: COLORS.textSecondary, flex: 1, fontSize: FONT_SIZES.sm, lineHeight: 20 },
  reviewHintTextReady: { color: COLORS.success },
  acceptedBox: { alignItems: 'center', backgroundColor: COLORS.successTint, borderRadius: RADIUS.md, flexDirection: 'row', gap: SPACING.md, padding: SPACING.md },
  acceptedIcon: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, height: 44, justifyContent: 'center', width: 44 },
  acceptedBody: { flex: 1 },
  acceptedTitle: { color: COLORS.success, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  acceptedText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 3 },
  footer: { backgroundColor: COLORS.surface, borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  footerHint: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, textAlign: 'center' },
  acceptButton: { alignItems: 'center', backgroundColor: COLORS.gold, borderRadius: RADIUS.md, flexDirection: 'row', gap: SPACING.sm, minHeight: 54, paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'center' },
  acceptButtonDisabled: { backgroundColor: COLORS.surfaceElevated, borderColor: COLORS.border, borderWidth: 1 },
  acceptButtonText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, lineHeight: 24, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  acceptButtonTextDisabled: { color: COLORS.textMuted },
});
