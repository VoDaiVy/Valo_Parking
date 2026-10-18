import { useCallback, useEffect, useState } from 'react';
import { Gift, Loader2, RefreshCw } from 'lucide-react';
import { getMyVouchers, getSpendingProgress } from '../../services/loyaltyService';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const statuses = { available: 'Có thể dùng', used: 'Đã dùng', expired: 'Hết hạn', revoked: 'Đã thu hồi' };
export default function LoyaltyRewards() {
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
        <div><p className="mb-2 text-xs font-bold uppercase tracking-widest text-yellow-400">VALO REWARDS</p><h1 className="text-4xl font-black">Voucher của tôi</h1><p className="mt-3 text-sm text-white/60">Nhận ưu đãi tự động theo chi tiêu hoặc quà tặng từ VALO. Không cần đổi điểm.</p></div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-white/15 p-3 hover:bg-white/10 disabled:opacity-50" aria-label="Tải lại"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </header>
      {error && <p role="alert" className="mb-5 rounded-xl bg-red-400/10 p-4 text-red-300">{error}</p>}
      {progress && <section className="mb-8 rounded-2xl border border-yellow-400/20 bg-yellow-400/5 p-6">
        <div className="flex flex-wrap justify-between gap-4"><div><h2 className="font-bold">Chi tiêu tháng {progress.month}</h2><p className="mt-2 text-3xl font-black tabular-nums text-yellow-300">{money(progress.total)}</p></div><p className="max-w-lg text-sm leading-6 text-white/60">{progress.enabled ? next ? `Còn ${money(Math.max(0, next.threshold - progress.total))} để nhận voucher ${money(next.discountAmount)}.` : 'Bạn đã đạt tất cả mốc thưởng tháng này.' : 'Chương trình thưởng tự động đang tạm dừng.'}<br />Voucher mới có hạn 7 ngày. Booking được tính sau khi thanh toán thành công, thường trong một phút.</p></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{progress.tiers.map((tier, index) => <div key={tier.threshold} className="border-t border-white/10 pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-white/45">Mốc {index + 1}</p>
          <p className="mt-2 text-sm text-white/75">Chi tiêu trong tháng đạt <strong className="block text-base text-white">{money(tier.threshold)}</strong></p>
          <p className="mt-3 text-sm text-white/75">Nhận voucher <strong className="text-yellow-300">giảm {money(tier.discountAmount)}</strong></p>
          <p className="mt-1 text-xs text-white/50">Voucher dùng cho đơn mới từ {money(tier.minimumAmount)}</p>
          <p className="mt-3 text-xs font-semibold text-white/60">{progress.total >= tier.threshold ? 'Đã đạt mức chi tiêu này' : `Còn ${money(tier.threshold - progress.total)} để đạt mốc`}</p>
        </div>)}</div>
        <p className="mt-5 text-xs leading-5 text-white/45">Tính booking đã thanh toán và các giao dịch hợp lệ khác theo số tiền thực trả; không tính nạp ví hay tiền phạt. Nếu một giao dịch vượt nhiều mốc, chỉ cấp voucher của mốc cao nhất. Hoàn tiền có thể thu hồi voucher chưa dùng.</p>
      </section>}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Lọc voucher">{[['all', 'Tất cả'], ...Object.entries(statuses)].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg px-4 py-2 text-sm font-bold ${filter === value ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{label}</button>)}</nav>
      {loading && <Loader2 className="mx-auto my-6 animate-spin text-yellow-400" aria-label="Đang tải" />}
      <div className="grid gap-4 md:grid-cols-2">{vouchers.filter((voucher) => filter === 'all' || voucher.status === filter).map((voucher) => {
        const benefit = voucher.benefitSnapshot;
        return <article key={voucher._id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start justify-between gap-3"><Gift className="text-yellow-400" /><span className={`text-xs font-bold ${voucher.status === 'available' ? 'text-emerald-300' : 'text-white/45'}`}>{statuses[voucher.status]}</span></div>
          <h2 className="mt-3 text-lg font-bold">{benefit.name}</h2>
          <p className="mt-2 text-sm text-yellow-300">{benefit.type === 'FIXED_DISCOUNT' ? `Giảm ${money(benefit.discountAmount)}` : benefit.type === 'PERCENT_DISCOUNT' ? `Giảm ${benefit.discountPercent}%` : `Miễn phí ${benefit.serviceId?.name || 'dịch vụ'}`}</p>
          <p className="mt-2 text-sm text-white/60">Đơn từ {money(benefit.minimumAmount)} · Một lần sử dụng</p>
          <p className="mt-2 text-xs text-white/50">Hết hạn {new Date(voucher.expiresAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ Việt Nam)</p>
          <p className="mt-2 text-xs text-white/45">{voucher.source === 'spending' ? 'Thưởng chi tiêu' : voucher.source === 'manual' ? 'Quà tặng từ VALO' : 'Voucher đã cấp trước đây'}</p>
          {voucher.status === 'available' && <p className="mt-4 text-sm text-yellow-300">{voucher.bookingId ? 'Đang giữ cho booking' : 'Chọn voucher này khi tạo booking.'}</p>}
        </article>;
      })}</div>
      {!loading && !vouchers.some((voucher) => filter === 'all' || voucher.status === filter) && <p className="py-12 text-center text-white/50">Chưa có voucher trong mục này.</p>}
    </div></main>
  );
}
