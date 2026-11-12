import { useCallback, useEffect, useState } from 'react';
import { Gift, Loader2, RefreshCw } from 'lucide-react';
import { getMyVouchers, getSpendingProgress } from '../../services/loyaltyService';
import { useLanguage } from '../../i18n/hooks/useLanguage';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const statuses = { available: 'Có thể dùng', used: 'Đã dùng', expired: 'Hết hạn', revoked: 'Đã thu hồi' };
export default function LoyaltyRewards() {
  const { t } = useLanguage();
  const [vouchers, setVouchers] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [owned, spending] = await Promise.all([getMyVouchers(), getSpendingProgress()]);
      if (!owned.ok || !spending.ok) throw new Error(owned.data?.message || spending.data?.message || 'Không thể tải voucher.');
      setVouchers(owned.data.data);
      setProgress(spending.data.data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const next = progress?.tiers.find((tier) => tier.threshold > Math.max(progress.total, progress.highestAwardedThreshold));
  return (
    <main className="min-h-full bg-[#0d0d0d] px-5 py-8 text-white lg:px-10"><div className="mx-auto max-w-6xl">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-yellow-400">VALO REWARDS</p><h1 className="text-4xl font-black">{t('rewardsPage.title')}</h1><p className="mt-3 text-sm text-white/60">{t('rewardsPage.description')}</p></div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-white/15 p-3 hover:bg-white/10 disabled:opacity-50" aria-label={t('common.refresh')}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </header>
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-400/10 p-4 text-red-300">{error}</p>}
      {progress && <section className="mb-8 rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-6">
        <div className="flex flex-wrap justify-between gap-4"><div><h2 className="font-bold">{t('rewardsPage.monthlySpend', { month: progress.month })}</h2><p className="mt-2 text-3xl font-black tabular-nums text-yellow-300">{money(progress.total)}</p></div><p className="max-w-lg text-sm leading-6 text-white/60">{progress.enabled ? next ? t('rewardsPage.nextReward', { amount: money(Math.max(0, next.threshold - progress.total)), discount: next.rewardType === 'PERCENT_DISCOUNT' ? `${next.discountPercent}%` : money(next.discountAmount) }) : t('rewardsPage.allTiers') : t('rewardsPage.paused')}<br />{t('rewardsPage.expiryHint')}</p></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{progress.tiers.map((tier, index) => <div key={tier.threshold} className="border-t border-white/10 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-white/45">{t('rewardsPage.tier', { index: index + 1 })}</p>
          <p className="mt-2 text-sm text-white/75">{t('rewardsPage.spendToReach')} <strong className="block text-base text-white">{money(tier.threshold)}</strong></p>
          <p className="mt-3 text-sm text-white/75">{t('rewardsPage.getVoucher')} <strong className="text-yellow-300">{tier.rewardType === 'PERCENT_DISCOUNT' ? t('rewardsPage.percentDiscount', { value: tier.discountPercent }) : t('rewardsPage.discount', { amount: money(tier.discountAmount) })}</strong></p>
          <p className="mt-1 text-xs text-white/50">{t('rewardsPage.minimumOrder', { amount: money(tier.minimumAmount) })}</p>
          <p className="mt-3 text-xs font-semibold text-white/60">{progress.total >= tier.threshold ? t('rewardsPage.reached') : t('rewardsPage.remaining', { amount: money(tier.threshold - progress.total) })}</p>
        </div>)}</div>
        <p className="mt-5 text-xs leading-5 text-white/45">{t('rewardsPage.terms')}</p>
      </section>}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label={t('rewardsPage.filterLabel')}>{[['all', t('common.all')], ...Object.entries(statuses).map(([value]) => [value, t(`rewardsPage.status.${value}`)])].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg px-4 py-2 text-sm font-bold ${filter === value ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{label}</button>)}</nav>
      {loading && <Loader2 className="mx-auto my-6 animate-spin text-yellow-400" aria-label="Đang tải" />}
      <div className="grid gap-4 md:grid-cols-2">{vouchers.filter((voucher) => filter === 'all' || voucher.status === filter).map((voucher) => {
        const benefit = voucher.benefitSnapshot;
        return <article key={voucher._id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-3"><Gift className="text-yellow-400" /><span className={`text-xs font-bold ${voucher.status === 'available' ? 'text-emerald-300' : 'text-white/45'}`}>{t(`rewardsPage.status.${voucher.status}`)}</span></div>
          <h2 className="mt-3 text-lg font-bold">{benefit.name}</h2>
          <p className="mt-2 text-sm text-yellow-300">{benefit.type === 'FIXED_DISCOUNT' ? t('rewardsPage.fixedDiscount', { amount: money(benefit.discountAmount) }) : benefit.type === 'PERCENT_DISCOUNT' ? t('rewardsPage.percentDiscount', { value: benefit.discountPercent }) : t('rewardsPage.freeService', { service: benefit.serviceId?.name || t('rewardsPage.service') })}</p>
          <p className="mt-2 text-sm text-white/60">Đơn từ {money(benefit.minimumAmount)} · Một lần sử dụng</p>
          <p className="mt-2 text-xs text-white/50">Hết hạn {new Date(voucher.expiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ Việt Nam)</p>
          <p className="mt-2 text-xs text-white/45">{voucher.source === 'spending' ? t('rewardsPage.spendingReward') : voucher.source === 'manual' ? t('rewardsPage.giftFromValo') : t('rewardsPage.previousVoucher')}</p>
          {voucher.status === 'available' && <p className="mt-4 text-sm text-yellow-300">{voucher.bookingId ? t('rewardsPage.heldForBooking') : t('rewardsPage.selectForBooking')}</p>}
        </article>;
      })}</div>
      {!loading && !vouchers.some((voucher) => filter === 'all' || voucher.status === filter) && <p className="py-12 text-center text-white/50">{t('rewardsPage.empty')}</p>}
    </div></main>
  );
}
