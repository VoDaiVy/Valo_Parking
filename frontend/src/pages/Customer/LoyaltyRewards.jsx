import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  Award,
  CalendarDays,
  Coins,
  Gift,
  History,
  Loader2,
  Sparkles,
  TicketCheck,
  TrendingUp,
} from 'lucide-react';
import {
  getLoyaltyAccount,
  getMyVouchers,
  getVoucherCatalog,
  redeemVoucher,
} from '../../services/loyaltyService';

const date = (value) => new Date(value).toLocaleDateString('vi-VN');
const transactionTone = { EARN: 'text-emerald-400', REDEEM: 'text-amber-300', REVOKE: 'text-rose-400' };

export default function LoyaltyRewards() {
  const [data, setData] = useState({ account: { balance: 0 }, transactions: [] });
  const [catalog, setCatalog] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [accountResponse, catalogResponse, voucherResponse] = await Promise.all([
      getLoyaltyAccount({ limit: 50 }),
      getVoucherCatalog(),
      getMyVouchers(),
    ]);
    if (accountResponse.ok) setData(accountResponse.data?.data || data);
    if (catalogResponse.ok) setCatalog(catalogResponse.data?.data || []);
    if (voucherResponse.ok) setVouchers(voucherResponse.data?.data || []);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const redeem = async (template) => {
    setRedeeming(template._id);
    setMessage({ type: '', text: '' });
    const response = await redeemVoucher(template._id);
    if (response.ok) {
      setMessage({ type: 'success', text: `Đã đổi thành công “${template.name}”.` });
      await load();
    } else {
      setMessage({ type: 'error', text: response.data?.message || 'Không thể đổi voucher.' });
      if (response.data?.code === 'VOUCHER_SOLD_OUT') await load();
    }
    setRedeeming('');
  };

  const balance = Number(data.account?.balance || 0);
  const hasStock = (template) => template.redemptionLimit == null
    || Number(template.redeemedCount || 0) < Number(template.redemptionLimit);
  const redeemableCount = catalog.filter((template) => hasStock(template) && balance >= template.pointCost).length;
  const nextReward = [...catalog]
    .filter((template) => hasStock(template) && template.pointCost > balance)
    .sort((first, second) => first.pointCost - second.pointCost)[0];
  const progressTarget = nextReward?.pointCost || Math.max(balance, 1);
  const rewardProgress = Math.min(100, Math.round((balance / progressTarget) * 100));

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center bg-[#0d0d0d]"><Loader2 className="animate-spin text-yellow-400" /></div>;

  return (
    <div className="min-h-full bg-[#0d0d0d] px-5 py-8 text-white lg:px-10">
      <div className="mx-auto max-w-7xl">
        <section className="relative mb-8 overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[#121312] shadow-[0_26px_80px_rgba(0,0,0,0.24)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.65)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.65)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="pointer-events-none absolute -right-16 -top-32 h-80 w-80 rounded-full bg-yellow-400/[0.09] blur-[90px]" />

          <div className="relative grid lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="px-6 pb-7 pt-7 sm:px-8 sm:pb-8 sm:pt-8 lg:px-10 lg:py-10">
              <p className="text-[11px] font-black uppercase tracking-[0.25em] text-yellow-400">Valo loyalty</p>
              <h1 className="mt-3 text-balance text-4xl font-black tracking-[-0.045em] text-white sm:text-5xl">Rewards & Vouchers</h1>
              <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/45">Mỗi 1.000 VND thanh toán hợp lệ tương ứng 1 điểm. Dùng điểm để đổi ưu đãi cho lần đặt chỗ tiếp theo.</p>

              <div className="mt-7 flex flex-wrap gap-x-8 gap-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-yellow-400"><TrendingUp size={16} /></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Tỷ lệ tích điểm</p><p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white">1.000 VND = 1 điểm</p></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-yellow-400"><Gift size={16} /></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Có thể đổi ngay</p><p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white">{redeemableCount}/{catalog.length} phần thưởng</p></div>
                </div>
              </div>
            </div>

            <aside className="relative border-t border-white/[0.07] bg-yellow-400/[0.045] p-6 lg:border-l lg:border-t-0 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-200/55">Điểm hiện có</p>
                  <div className="mt-2 flex items-end gap-2">
                    <p className="font-mono text-5xl font-black leading-none tracking-[-0.055em] text-yellow-400 tabular-nums sm:text-6xl">{balance.toLocaleString('vi-VN')}</p>
                    <span className="mb-1 text-sm font-bold text-yellow-200/45">điểm</span>
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-yellow-400/20 bg-yellow-400/10 text-yellow-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"><Coins size={21} /></div>
              </div>

              <div className="mt-7">
                <div className="mb-2 flex items-center justify-between gap-4 text-[11px] font-semibold">
                  <span className="text-white/40">{nextReward ? `Còn ${Math.max(0, nextReward.pointCost - balance).toLocaleString('vi-VN')} điểm để đổi ${nextReward.name}` : 'Bạn có thể đổi mọi phần thưởng'}</span>
                  <span className="font-mono text-yellow-300/80 tabular-nums">{rewardProgress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className="h-full rounded-full bg-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.35)] transition-[width] duration-500" style={{ width: `${rewardProgress}%` }} />
                </div>
              </div>

              <button type="button" onClick={() => document.getElementById('reward-catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="mt-6 inline-flex items-center gap-2 text-xs font-black text-yellow-300 transition hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400/30 active:translate-y-px">
                Xem phần thưởng <ArrowDown size={14} />
              </button>
            </aside>
          </div>
        </section>

        {message.text && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-bold ${message.type === 'error' ? 'border-rose-500/20 bg-rose-500/10 text-rose-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'}`}>{message.text}</div>}

        <section id="reward-catalog" className="mb-8 scroll-mt-6"><div className="mb-4 flex items-center gap-2"><Gift className="text-yellow-400" size={20} /><h2 className="text-xl font-black">Đổi điểm</h2></div><div className="grid gap-4 md:grid-cols-2">{catalog.map((template) => {
          const enough = balance >= template.pointCost;
          const available = hasStock(template);
          const remaining = template.redemptionLimit == null
            ? null
            : Math.max(0, Number(template.redemptionLimit) - Number(template.redeemedCount || 0));
          return <article key={template._id} className={`group flex min-h-60 flex-col rounded-2xl border bg-white/[0.04] p-5 transition duration-200 ${available ? 'border-white/10 hover:-translate-y-0.5 hover:border-yellow-400/20 hover:bg-white/[0.055]' : 'border-white/[0.06] opacity-60'}`}><div className="flex items-start justify-between gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400 transition-transform duration-200 group-hover:scale-105">{template.type === 'PERCENT_DISCOUNT' ? <Sparkles /> : <Award />}</div><div className="flex flex-col items-end gap-1.5"><span className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1 text-xs font-black text-yellow-300">{template.pointCost} điểm</span>{remaining !== null && <span className={`text-[10px] font-black uppercase tracking-wide ${remaining > 0 ? 'text-amber-300' : 'text-rose-300'}`}>{remaining > 0 ? `Còn ${remaining} voucher` : 'Hết voucher'}</span>}</div></div><h3 className="mt-4 text-lg font-black">{template.name}</h3><p className="mt-1 min-h-10 text-sm text-white/45">{template.description || (template.type === 'PERCENT_DISCOUNT' ? `Giảm ${template.discountPercent}% cho booking` : `Miễn phí ${template.serviceId?.name || 'dịch vụ'}`)}</p><button onClick={() => redeem(template)} disabled={!available || !enough || redeeming === template._id} className="mt-auto w-full rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-black text-black transition duration-200 hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-400/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35">{redeeming === template._id ? 'Đang đổi...' : !available ? 'Hết voucher' : enough ? 'Đổi voucher' : `Cần thêm ${(template.pointCost - balance).toLocaleString('vi-VN')} điểm`}</button></article>;
        })}{catalog.length === 0 && <p className="text-sm text-white/40">Chưa có phần thưởng đang hoạt động.</p>}</div></section>

        <div className="grid gap-7 xl:grid-cols-2">
          <section><div className="mb-4 flex items-center gap-2"><TicketCheck className="text-yellow-400" size={20} /><h2 className="text-xl font-black">Voucher của tôi</h2></div><div className="space-y-3">{vouchers.map((voucher) => <div key={voucher._id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div><p className="font-black">{voucher.benefitSnapshot?.name}</p><p className="mt-1 text-xs text-white/45">Hết hạn {date(voucher.expiresAt)}{voucher.bookingId && voucher.status === 'available' ? ' · Đang giữ cho booking' : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${voucher.status === 'available' ? 'bg-emerald-500/10 text-emerald-300' : voucher.status === 'used' ? 'bg-white/10 text-white/45' : 'bg-rose-500/10 text-rose-300'}`}>{voucher.status}</span></div>)}{vouchers.length === 0 && <p className="text-sm text-white/40">Bạn chưa đổi voucher nào.</p>}</div></section>
          <section><div className="mb-4 flex items-center gap-2"><History className="text-yellow-400" size={20} /><h2 className="text-xl font-black">Lịch sử điểm</h2></div><div className="overflow-hidden rounded-2xl border border-white/10">{data.transactions.map((transaction) => <div key={transaction._id} className="flex items-center justify-between border-b border-white/10 bg-white/[0.035] p-4 last:border-0"><div className="flex items-center gap-3"><CalendarDays size={16} className="text-white/30" /><div><p className="text-sm font-bold">{transaction.type === 'EARN' ? 'Tích điểm' : transaction.type === 'REDEEM' ? 'Đổi voucher' : 'Thu hồi điểm'}</p><p className="text-xs text-white/35">{new Date(transaction.createdAt).toLocaleString('vi-VN')}</p></div></div><p className={`font-black ${transactionTone[transaction.type]}`}>{transaction.type === 'EARN' ? '+' : '-'}{transaction.amount}</p></div>)}{data.transactions.length === 0 && <p className="p-6 text-sm text-white/40">Chưa có giao dịch điểm.</p>}</div></section>
        </div>
      </div>
    </div>
  );
}
