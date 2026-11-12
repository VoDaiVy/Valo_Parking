import { useCallback, useEffect, useState } from 'react';
import { Gift, Plus, Send, Trash2, X } from 'lucide-react';
import { getServices } from '../../services/extraServiceApi';
import QuarterlyLeaderboard from './QuarterlyLeaderboard';
import {
  getVoucherTemplatesAdmin, createVoucherTemplate, updateVoucherTemplate,
  getSpendingProgram, saveSpendingProgram, searchVoucherRecipients, distributeVouchers,
  updateVoucherExpiry,
} from '../../services/loyaltyService';

const inputClass = 'mt-2 w-full rounded-xl border border-white/15 bg-[#161616] px-3 py-2.5 text-sm text-white outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400';
const buttonClass = 'rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-bold text-black hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50';
const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const emptyForm = { name: '', description: '', type: 'FIXED_DISCOUNT', discountAmount: 20000, minimumAmount: 100000, discountPercent: 10, serviceId: '', redemptionLimit: '', isActive: true };
const unwrap = (response) => { if (!response.ok) throw new Error(response.data?.errors?.map((item) => item.message).join('; ') || response.data?.message || 'Không thể thực hiện. Vui lòng thử lại.'); return response.data.data; };

export default function VoucherManagement() {
  const [tab, setTab] = useState('auto');
  const [program, setProgram] = useState(null);
  const [stats, setStats] = useState({});
  const [templates, setTemplates] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(null);
  const [sending, setSending] = useState(null);
  const [sendExpiresAt, setSendExpiresAt] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [query, setQuery] = useState('');
  const [suggestedRecipient, setSuggestedRecipient] = useState('');
  const [results, setResults] = useState([]);
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, catalog, extras] = await Promise.all([getSpendingProgram(), getVoucherTemplatesAdmin(), getServices()]);
      const data = unwrap(settings);
      setProgram(data.program); setStats(data.stats); setVouchers(data.vouchers || []); setTemplates(unwrap(catalog));
      if (extras.ok) setServices(extras.data?.data || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!sending || query.trim().length < 2) { setResults([]); return; }
      try {
        const found = unwrap(await searchVoucherRecipients(query.trim()));
        if (!cancelled) setResults(found.filter((user) => user.role === 'customer' && !recipients.some((item) => item._id === user._id)));
      } catch (err) { if (!cancelled) setError(err.message); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, recipients, sending]);
  const perform = async (work) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const saveTemplate = (event) => {
    event.preventDefault();
    void perform(async () => {
      const payload = { ...form,
        discountAmount: form.type === 'FIXED_DISCOUNT' ? Number(form.discountAmount) : 0,
        minimumAmount: Number(form.minimumAmount),
        discountPercent: form.type === 'PERCENT_DISCOUNT' ? Number(form.discountPercent) : null,
        serviceId: form.type === 'FREE_SERVICE' ? form.serviceId : null,
        redemptionLimit: form.redemptionLimit === '' ? null : Number(form.redemptionLimit),
      };
      unwrap(await (form._id ? updateVoucherTemplate(form._id, payload) : createVoucherTemplate(payload)));
      setForm(null); await load(); setNotice('Đã lưu mẫu voucher. Chọn Gửi để cấp cho khách hàng.');
    });
  };
  return (
    <main className="min-h-full bg-[#0c0d0d] px-5 py-8 text-white sm:px-8"><div className="mx-auto max-w-6xl">
      <header className="mb-7"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-yellow-400"><Gift size={16} /> VALO REWARDS</p><h1 className="text-4xl font-black">Voucher management</h1><p className="mt-3 text-sm text-white/55">Thưởng theo chi tiêu hoặc gửi quà trực tiếp. Mọi voucher mới có hạn 7 ngày, kèm thông báo và email.</p></header>
      <div className="mb-6 flex flex-wrap gap-6 border-y border-white/10 py-4 text-sm text-white/60"><span>Đã cấp <strong className="ml-2 text-white">{stats.issued || 0}</strong></span><span>Đã dùng <strong className="ml-2 text-white">{stats.used || 0}</strong></span><span>Email chờ gửi <strong className="ml-2 text-yellow-300">{stats.pendingEmails || 0}</strong></span></div>
      {stats.retryingEmails > 0 && <p role="alert" className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">Có {stats.retryingEmails} email voucher gửi chưa thành công. Hệ thống sẽ thử lại; admin cần kiểm tra cấu hình đăng nhập SMTP nếu tình trạng kéo dài.</p>}
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Quản lý voucher">{[['auto', 'Tự động theo chi tiêu'], ['manual', 'Gửi trực tiếp'], ['leaderboard', 'Xếp hạng theo quý']].map(([key, label]) => <button key={key} onClick={() => { setTab(key); setError(''); }} aria-pressed={tab === key} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === key ? 'bg-yellow-400 text-black' : 'bg-white/5 text-white/60'}`}>{label}</button>)}</nav>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-400/10 p-4 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-300">{notice}</p>}
      {loading && <p className="py-6 text-white/50">Đang tải…</p>}
      {!loading && !program && <button onClick={load} className={buttonClass}>Thử tải lại</button>}
      {tab === 'leaderboard' && <QuarterlyLeaderboard onChooseRecipient={(row) => { setSuggestedRecipient(row.username); setTab('manual'); setNotice(`Chọn mẫu voucher để gửi cho ${row.username}.`); }} />}
      {tab === 'auto' && program && <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { setProgram(unwrap(await saveSpendingProgram(program))); setNotice('Đã lưu chương trình thưởng.'); }); }}>
        <fieldset disabled={busy} className="rounded-2xl border border-white/10 p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold">Mốc thưởng hàng tháng</h2><p className="mt-2 text-sm text-white/55">Tính theo giờ Việt Nam. Bắt đầu ghi nhận từ lần bật đầu tiên.</p></div><div className="flex flex-wrap items-end gap-5"><label className="text-xs text-white/60">Hạn voucher (ngày)<input type="number" min="1" max="365" step="1" required value={program.validityDays ?? 7} onChange={(event) => setProgram({ ...program, validityDays: event.target.value === '' ? '' : Number(event.target.value) })} className="mt-2 w-36 rounded-xl border border-white/15 bg-[#161616] px-3 py-2.5 text-sm text-white outline-none focus:border-yellow-400" /></label><label className="flex items-center gap-3 pb-2 text-sm font-bold"><input type="checkbox" checked={program.enabled} onChange={(event) => setProgram({ ...program, enabled: event.target.checked })} className="h-5 w-5 accent-yellow-400" />{program.enabled ? 'Đang bật' : 'Đang tắt'}</label></div></div>
          <div className="space-y-4">{program.tiers.map((tier, index) => <div key={index} className="grid items-end gap-3 border-t border-white/10 pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]">{[['threshold', 'Chi tiêu đạt (VND)'], ['discountAmount', 'Giá trị voucher (VND)'], ['minimumAmount', 'Đơn tối thiểu (VND)']].map(([key, label]) => <label key={key} className="text-xs text-white/60">{label}<input type="number" min="1000" max="1000000000" step="1" required value={tier[key]} onChange={(event) => setProgram({ ...program, tiers: program.tiers.map((item, i) => i === index ? { ...item, [key]: event.target.value === '' ? '' : Number(event.target.value) } : item) })} className={inputClass} /></label>)}<button type="button" disabled={program.tiers.length === 1} onClick={() => setProgram({ ...program, tiers: program.tiers.filter((_, i) => i !== index) })} className="p-3 text-red-300 disabled:opacity-30" aria-label={`Xóa mốc ${index + 1}`}><Trash2 size={18} /></button></div>)}</div>
          <button type="button" disabled={program.tiers.length >= 10} onClick={() => setProgram({ ...program, tiers: [...program.tiers, { threshold: '', discountAmount: '', minimumAmount: '' }] })} className="mt-4 flex items-center gap-2 text-sm font-bold text-yellow-300 disabled:opacity-40"><Plus size={16} /> Thêm mốc</button>
          <p className="mt-6 text-sm leading-6 text-white/55">Mỗi mốc chỉ nhận một lần trong tháng. Voucher tự động có hạn {program.validityDays || 7} ngày từ lúc cấp. Một giao dịch vượt nhiều mốc chỉ nhận mốc cao nhất. Booking được tính ngay sau khi thanh toán thành công, theo số tiền thực trả sau giảm giá và hoàn tiền; không tính nạp ví, chuyển tiền hay tiền phạt. Voucher chưa dùng có thể bị thu hồi nếu hoàn tiền làm chi tiêu thấp hơn mốc.</p>
          <p className="mt-2 text-xs leading-5 text-white/40">Thay đổi mốc không cấp bù cho giao dịch đã xử lý. Khi tạm dừng, chi tiêu vẫn được ghi nhận; giao dịch tiếp theo sau khi bật lại mới xét thưởng.</p>
          <button type="submit" className={`${buttonClass} mt-6`}>{busy ? 'Đang lưu…' : 'Lưu chương trình'}</button>
        </fieldset>
      </form>}
      {tab === 'manual' && <section>
        <div className="mb-5 flex justify-between gap-4"><h2 className="text-xl font-bold">Mẫu voucher</h2><button onClick={() => { setForm({ ...emptyForm }); setError(''); }} className={buttonClass}>Tạo voucher</button></div>
        <div className="space-y-3">{templates.map((template) => <article key={template._id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 p-5"><div><h3 className="font-bold">{template.name}</h3><p className="mt-1 text-sm text-white/55">{template.type === 'FIXED_DISCOUNT' ? `Giảm ${money(template.discountAmount)}` : template.type === 'PERCENT_DISCOUNT' ? `Giảm ${template.discountPercent}%` : `Miễn phí ${template.serviceId?.name || 'dịch vụ'}`} · Đơn từ {money(template.minimumAmount)} · {template.isActive ? 'Đang bật' : 'Đã tắt'}</p><p className="mt-1 text-xs text-white/40">Đã cấp {template.redeemedCount || 0}{template.redemptionLimit != null ? ` / ${template.redemptionLimit}` : ''}</p></div><div className="flex gap-3"><button onClick={() => { setForm({ ...emptyForm, ...template, serviceId: template.serviceId?._id || template.serviceId || '', redemptionLimit: template.redemptionLimit ?? '' }); setError(''); }} className="px-3 text-sm text-white/70">Chỉnh sửa</button><button disabled={!template.isActive || busy} onClick={() => { setSending(template); setSendExpiresAt(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16)); setRecipients([]); setQuery(suggestedRecipient); setSuggestedRecipient(''); setRequestId(crypto.randomUUID()); setError(''); }} className={`${buttonClass} flex items-center gap-2`}><Send size={15} /> Gửi</button></div></article>)}</div>
        {!loading && !templates.length && <p className="py-8 text-center text-white/50">Tạo mẫu đầu tiên để gửi ưu đãi cho khách hàng.</p>}
        <div className="mt-8 rounded-2xl border border-white/10 p-5"><div className="mb-4"><h2 className="text-xl font-bold">Voucher đã phát</h2><p className="mt-1 text-sm text-white/50">Admin có thể gia hạn voucher chưa dùng. Voucher đã dùng hoặc thu hồi không thể chỉnh sửa.</p></div><div className="space-y-3">{vouchers.map((voucher) => <div key={voucher._id} className="grid gap-3 rounded-xl border border-white/10 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><p className="font-bold">{voucher.benefitSnapshot?.name || 'Voucher'}</p><p className="text-xs text-white/50">{voucher.userId?.username || voucher.userId?.email || 'Khách hàng'} · {voucher.status}</p></div><span className="text-xs text-white/50">Hết hạn: {new Date(voucher.expiresAt).toLocaleString('vi-VN')}</span><button disabled={busy || ['used', 'revoked'].includes(voucher.status)} onClick={() => { const current = new Date(voucher.expiresAt); const value = window.prompt('Nhập ngày hết hạn mới (YYYY-MM-DD hoặc ISO):', current.toISOString().slice(0, 16)); if (!value) return; void perform(async () => { unwrap(await updateVoucherExpiry(voucher._id, new Date(value).toISOString())); await load(); setNotice('Đã cập nhật hạn dùng voucher.'); }); }} className="rounded-lg border border-yellow-400/40 px-3 py-2 text-xs font-bold text-yellow-300 disabled:cursor-not-allowed disabled:opacity-40">Chỉnh hạn</button></div>)}{!vouchers.length && <p className="py-5 text-sm text-white/50">Chưa có voucher nào.</p>}</div></div>
      </section>}
      {form && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><form onSubmit={saveTemplate} role="dialog" aria-modal="true" aria-label="Mẫu voucher" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#111] p-6">
        <div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{form._id ? 'Chỉnh sửa voucher' : 'Tạo voucher'}</h2><button type="button" disabled={busy} onClick={() => setForm(null)} aria-label="Đóng"><X /></button></div>
        {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-white/60 sm:col-span-2">Tên voucher<input required maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
          <label className="text-xs text-white/60 sm:col-span-2">Mô tả<textarea maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} /></label>
          <label className="text-xs text-white/60">Loại ưu đãi<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={inputClass}><option value="FIXED_DISCOUNT">Giảm số tiền</option><option value="PERCENT_DISCOUNT">Giảm phần trăm</option><option value="FREE_SERVICE">Miễn phí dịch vụ</option></select></label>
          {form.type === 'FREE_SERVICE' ? <label className="text-xs text-white/60">Dịch vụ<select required value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })} className={inputClass}><option value="">Chọn dịch vụ</option>{services.filter((service) => service.isActive).map((service) => <option key={service._id} value={service._id}>{service.name}</option>)}</select></label> : <label className="text-xs text-white/60">{form.type === 'FIXED_DISCOUNT' ? 'Số tiền giảm (VND)' : 'Phần trăm giảm'}<input required type="number" min={form.type === 'FIXED_DISCOUNT' ? 1000 : 1} max={form.type === 'FIXED_DISCOUNT' ? 1000000000 : 100} step="1" value={form.type === 'FIXED_DISCOUNT' ? form.discountAmount : form.discountPercent} onChange={(event) => setForm({ ...form, [form.type === 'FIXED_DISCOUNT' ? 'discountAmount' : 'discountPercent']: event.target.value })} className={inputClass} /></label>}
          <label className="text-xs text-white/60">Đơn tối thiểu (VND)<input required type="number" min="0" max="1000000000" step="1" value={form.minimumAmount} onChange={(event) => setForm({ ...form, minimumAmount: event.target.value })} className={inputClass} /></label>
          <label className="text-xs text-white/60">Giới hạn số lượng (để trống = không giới hạn)<input type="number" min="1" step="1" value={form.redemptionLimit} onChange={(event) => setForm({ ...form, redemptionLimit: event.target.value })} className={inputClass} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Cho phép gửi</label><p className="text-xs text-white/50">Có hạn 7 ngày kể từ lúc gửi.</p>
          <button className={`${buttonClass} sm:col-span-2`} type="submit">{busy ? 'Đang lưu…' : 'Lưu mẫu voucher'}</button>
        </fieldset>
      </form></div>}
      {sending && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><section role="dialog" aria-modal="true" aria-label="Gửi voucher" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-[#111] p-6">
        <div className="flex justify-between gap-4"><h2 className="text-xl font-bold">Gửi {sending.name}</h2><button disabled={busy} onClick={() => setSending(null)} aria-label="Đóng"><X /></button></div><p className="mt-3 text-sm text-white/55">Chọn ngày hết hạn cho voucher. Email và thông báo sẽ hiển thị đúng ngày này.</p>
        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        <label className="mt-5 block text-xs text-white/60">Tìm khách hàng theo tên hoặc email<input value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} placeholder="Nhập ít nhất 2 ký tự" className={inputClass} /></label>
        <label className="mt-4 block text-xs text-white/60">Ngày hết hạn<input required type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={sendExpiresAt} disabled={busy} onChange={(event) => setSendExpiresAt(event.target.value)} className={inputClass} /></label>
        <div className="mt-3 flex flex-wrap gap-2">{recipients.map((user) => <button key={user._id} disabled={busy} onClick={() => { setRecipients(recipients.filter((item) => item._id !== user._id)); setRequestId(crypto.randomUUID()); }} className="rounded-lg bg-yellow-400/10 px-3 py-2 text-xs text-yellow-300" aria-label={`Bỏ ${user.email}`}>{user.email} ×</button>)}</div>
        <div className="mt-3 max-h-56 overflow-auto">{results.map((user) => <button key={user._id} disabled={busy || recipients.length >= 100} onClick={() => { setRecipients([...recipients, user]); setRequestId(crypto.randomUUID()); }} className="block w-full border-b border-white/10 px-2 py-3 text-left text-sm hover:bg-white/5">{user.username}<span className="ml-2 text-xs text-white/50">{user.email}</span></button>)}</div>
        {query.trim().length >= 2 && !results.length && <p className="mt-3 text-xs text-white/50">Không có khách hàng phù hợp chưa được chọn.</p>}
        <button disabled={busy || !recipients.length || !sendExpiresAt} onClick={() => void perform(async () => { const result = unwrap(await distributeVouchers(sending._id, { userIds: recipients.map((user) => user._id), requestId, expiresAt: new Date(sendExpiresAt).toISOString() })); setSending(null); await load(); setNotice(`Đã cấp voucher cho ${result.userIds.length} khách hàng. Email đang được gửi.`); })} className={`${buttonClass} mt-6 w-full`}>{busy ? 'Đang gửi…' : `Gửi cho ${recipients.length} người`}</button>
      </section></div>}
    </div></main>
  );
}
