import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ErrorState } from '@/components/common';
import { CustomerAmbientBackground } from '@/components/customer/CustomerAmbientBackground';
import { walletService } from '@/services/api/wallet';
import { statisticsService, type CustomerBookingStatistics } from '@/services/api/statistics';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { formatCurrency } from '@/utils/formatters';
import { useLanguage } from '@/contexts/LanguageContext';
import type { WalletStackParamList } from '@/navigation/types';
import type { Wallet } from '@/types/models';
type Props = NativeStackScreenProps<WalletStackParamList, 'Wallet'>;

function ActionBtn({ icon, label, color, bg, onPress }: { icon: string; label: string; color: string; bg: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.actionIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={24} color={color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export const WalletScreen = ({ navigation }: Props) => {
  const { t } = useLanguage();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [bookingStats, setBookingStats] = useState<CustomerBookingStatistics | null>(null);
  const load = useCallback(async () => {
    setError('');
    try {
      const [walletResult, statisticsResult] = await Promise.allSettled([
        walletService.getWallet(),
        statisticsService.getCustomerBookings('30d'),
      ]);
      if (walletResult.status === 'rejected') throw walletResult.reason;
      setWallet(walletResult.value.data || null);
      if (statisticsResult.status === 'fulfilled') {
        setBookingStats(statisticsResult.value.data || null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load wallet.');
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <CustomerAmbientBackground />
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} />}>
        {error ? (
          <View style={styles.errorWrap}>
            <ErrorState message={error} onRetry={load} />
          </View>
        ) : (
          <>
            <View style={styles.pageHeader}>
              <View>
                <Text style={styles.pageEyebrow}>VALO WALLET</Text>
                <Text style={styles.pageTitle}>{t('wallet')}</Text>
                <Text style={styles.pageSubtitle}>Top up, track spending, and manage your parking benefits.</Text>
              </View>
              <View style={styles.pageIcon}><Ionicons name="wallet-outline" size={21} color={COLORS.gold} /></View>
            </View>
            <View style={styles.balanceCard}>
              <LinearGradient colors={['#1C1A0F','#0D0D0D']} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={[COLORS.gold,'transparent']} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.topLine} />
              <Text style={styles.balanceLabel}>Available balance</Text>
              {loading ? <ActivityIndicator color={COLORS.gold} size="large" style={{marginVertical:SPACING.lg}} /> : <Text style={styles.balanceValue}>{formatCurrency(wallet?.balance ?? 0)}</Text>}
              {wallet?.overdraftLimit !== undefined && wallet.overdraftLimit < 0 && <Text style={styles.overdraftText}>Overdraft: {formatCurrency(wallet.overdraftLimit)}</Text>}
            </View>
            <View style={styles.actionsPanel}>
              <Text style={styles.sectionTitle}>Quick access</Text>
              <View style={styles.actionsRow}>
                <ActionBtn icon="add-circle-outline" label="Top up" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('TopUp')} />
                <ActionBtn icon="time-outline" label="History" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('TransactionHistory')} />
                <ActionBtn icon="ribbon-outline" label="Membership" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('MembershipHub')} />
                <ActionBtn icon="cube-outline" label="Plans" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('SubscriptionPackages')} />
                <ActionBtn icon="gift-outline" label="Voucher" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('Rewards')} />
                <ActionBtn icon="swap-horizontal-outline" label="Transfers" color={COLORS.gold} bg="rgba(226,186,75,0.12)" onPress={() => navigation.navigate('MembershipMarketplace')} />
              </View>
            </View>
            {wallet && <>
              <Text style={styles.sectionTitle}>This month</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCard}><Ionicons name="arrow-down-circle-outline" size={20} color="#7EE8A2" /><Text style={[styles.statValue,{color:'#7EE8A2'}]}>{formatCurrency(wallet.monthlyTopUp??0)}</Text><Text style={styles.statLabel}>Added</Text></View>
                <View style={styles.statCard}><Ionicons name="arrow-up-circle-outline" size={20} color="#FF9F43" /><Text style={[styles.statValue,{color:'#FF9F43'}]}>{formatCurrency(wallet.monthlySpent??0)}</Text><Text style={styles.statLabel}>Spent</Text></View>
                <View style={styles.statCard}><Ionicons name="refresh-circle-outline" size={20} color="#60B4FF" /><Text style={[styles.statValue,{color:'#60B4FF'}]}>{formatCurrency(wallet.monthlyRefunded??0)}</Text><Text style={styles.statLabel}>Refunded</Text></View>
              </View>
            </>}
            {bookingStats ? (
              <View style={styles.insightsSection}>
                <View style={styles.insightsHeader}>
                  <View>
                    <Text style={styles.insightsTitle}>Your parking story</Text>
                    <Text style={styles.insightsSubtitle}>Last 30 days</Text>
                  </View>
                  <View style={styles.insightsIcon}>
                    <Ionicons name="analytics-outline" size={20} color={COLORS.gold} />
                  </View>
                </View>
                <View style={styles.insightsGrid}>
                  <View style={styles.insightMetric}>
                    <Text style={styles.insightLabel}>Bookings</Text>
                    <Text style={styles.insightValue}>{bookingStats.operational.totalBookings}</Text>
                    <Text style={styles.insightNote}>{bookingStats.operational.completedBookings} completed</Text>
                  </View>
                  <View style={styles.insightMetric}>
                    <Text style={styles.insightLabel}>Net booking spend</Text>
                    <Text style={styles.insightValue}>{formatCurrency(bookingStats.money.walletNetBookingSpend)}</Text>
                    <Text style={styles.insightNote}>{formatCurrency(bookingStats.money.walletBookingRefunds)} refunded</Text>
                  </View>
                </View>
                {bookingStats.money.financialCoverage === 'partial' ? (
                  <Text style={styles.coverageNote}>
                    Wallet totals include transactions with a verified booking reference. PayOS
                    history is estimated from booking records.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:COLORS.background},
  pageHeader:{alignItems:'center',flexDirection:'row',gap:SPACING.md,justifyContent:'space-between',paddingHorizontal:SPACING.lg,paddingTop:SPACING.lg,paddingBottom:SPACING.md},
  pageEyebrow:{color:COLORS.gold,fontSize:FONT_SIZES.xs,fontWeight:'900',letterSpacing:1.2},
  pageTitle:{color:COLORS.textPrimary,fontSize:26,fontWeight:'900',marginTop:4},
  pageSubtitle:{color:COLORS.textMuted,fontSize:FONT_SIZES.xs,lineHeight:18,marginTop:4,maxWidth:280},
  pageIcon:{alignItems:'center',backgroundColor:'rgba(226,186,75,0.1)',borderColor:'rgba(226,186,75,0.24)',borderRadius:RADIUS.md,borderWidth:1,height:44,justifyContent:'center',width:44},
  balanceCard:{marginHorizontal:SPACING.lg,marginTop:SPACING.md,marginBottom:SPACING.md,borderRadius:RADIUS.xl,padding:SPACING.xl,borderWidth:1,borderColor:'rgba(212,175,55,0.25)',overflow:'hidden',alignItems:'center'},
  topLine:{position:'absolute',top:0,left:0,right:0,height:2},
  balanceLabel:{fontSize:FONT_SIZES.sm,color:COLORS.textSecondary,marginBottom:SPACING.sm},
  balanceValue:{fontSize:36,fontWeight:'800',color:COLORS.gold,letterSpacing:1},
  overdraftText:{fontSize:FONT_SIZES.xs,color:COLORS.textMuted,marginTop:SPACING.sm},
  actionsPanel:{backgroundColor:'rgba(255,255,255,0.025)',borderColor:'rgba(226,186,75,0.16)',borderRadius:RADIUS.xl,borderWidth:1,marginHorizontal:SPACING.lg,marginBottom:SPACING.sm,paddingTop:SPACING.sm},
  actionsRow:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:SPACING.md,paddingHorizontal:SPACING.md,paddingBottom:SPACING.md},
  actionBtn:{alignItems:'center',gap:SPACING.xs,width:'31%',minHeight:80},
  actionIconWrap:{width:52,height:52,borderRadius:RADIUS.md,justifyContent:'center',alignItems:'center'},
  actionLabel:{fontSize:FONT_SIZES.xs,color:COLORS.textSecondary},
  sectionTitle:{fontSize:FONT_SIZES.sm,fontWeight:'600',color:COLORS.textMuted,textTransform:'uppercase',letterSpacing:0.5,paddingHorizontal:SPACING.lg,paddingTop:SPACING.lg,paddingBottom:SPACING.sm},
  statsRow:{flexDirection:'row',paddingHorizontal:SPACING.lg,gap:SPACING.sm,marginBottom:SPACING.xl},
  statCard:{flex:1,backgroundColor:COLORS.surface,borderRadius:RADIUS.lg,padding:SPACING.md,alignItems:'center',gap:4,borderWidth:1,borderColor:COLORS.border},
  statValue:{fontSize:FONT_SIZES.md,fontWeight:'700'},
  statLabel:{fontSize:FONT_SIZES.xs,color:COLORS.textMuted},
  errorWrap:{paddingHorizontal:SPACING.lg,paddingTop:SPACING.lg},
  insightsSection:{marginHorizontal:SPACING.lg,marginBottom:SPACING.xl,backgroundColor:COLORS.surface,borderRadius:RADIUS.xl,borderWidth:1,borderColor:'rgba(212,175,55,0.16)',padding:SPACING.lg,gap:SPACING.md},
  insightsHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  insightsTitle:{color:COLORS.textPrimary,fontSize:FONT_SIZES.lg,fontWeight:'900'},
  insightsSubtitle:{color:COLORS.textMuted,fontSize:FONT_SIZES.xs,marginTop:2},
  insightsIcon:{width:42,height:42,borderRadius:RADIUS.md,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(212,175,55,0.1)'},
  insightsGrid:{flexDirection:'row',gap:SPACING.md},
  insightMetric:{flex:1,borderLeftWidth:1,borderLeftColor:COLORS.border,paddingLeft:SPACING.md},
  insightLabel:{color:COLORS.textMuted,fontSize:FONT_SIZES.xs},
  insightValue:{color:COLORS.textPrimary,fontSize:FONT_SIZES.lg,fontWeight:'900',marginTop:4},
  insightNote:{color:COLORS.textSecondary,fontSize:10,marginTop:3},
  coverageNote:{color:COLORS.textMuted,fontSize:FONT_SIZES.xs,lineHeight:18},
});
