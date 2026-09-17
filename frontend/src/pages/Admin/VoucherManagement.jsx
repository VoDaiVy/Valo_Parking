import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Bell, Check, Coins, Edit2, Gift, Loader2, Percent,
  Plus, Power, Sparkles, Trash2, Wrench, X,
} from 'lucide-react';
import AdminBackgroundOverlay from '../../components/Admin/AdminBackgroundOverlay';
import AdminSelect from '../../components/Admin/AdminSelect';
import { getServices } from '../../services/extraServiceApi';
import {
  createVoucherTemplate,
  deactivateVoucherTemplate,
  deleteVoucherTemplate,
  getVoucherTemplatesAdmin,
  updateVoucherTemplate,
} from '../../services/loyaltyService';

const emptyForm = {
  name: '', description: '', type: 'PERCENT_DISCOUNT', pointCost: 100,
  discountPercent: 10, serviceId: '', isActive: true,
  redemptionLimit: '', notifyCustomers: false,
};
const fieldClass = 'mt-2 w-full rounded-xl border border-white/[0.09] bg-white/[0.035] px-3.5 py-3 text-sm font-semibold text-white outline-none transition duration-200 placeholder:text-white/20 hover:border-white/15 focus:border-[#f3c43d]/70 focus:bg-white/[0.055] focus:ring-4 focus:ring-[#f3c43d]/[0.08]';
const numberFieldClass = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const actionClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#f3c43d]/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';
const rewardTypeOptions = [
  { value: 'PERCENT_DISCOUNT', label: 'Percentage discount' },
  { value: 'FREE_SERVICE', label: 'Free service' },
];

function BenefitMark({ template, large = false }) {
  const Icon = template.type === 'PERCENT_DISCOUNT' ? Percent : Wrench;
  return (
    <div className={`flex shrink-0 items-center justify-center border border-[#f3c43d]/20 bg-[#f3c43d]/[0.08] text-[#f3c43d] ${large ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl'}`}>
      <Icon size={large ? 20 : 17} strokeWidth={1.8} />
    </div>
  );
}

function VoucherSkeleton() {
  return Array.from({ length: 4 }, (_, index) => (
    <div key={index} className="grid grid-cols-[minmax(240px,1.4fr)_minmax(240px,1.7fr)_140px_130px_150px] items-center gap-5 border-t border-white/[0.055] px-5 py-4 first:border-t-0">
      <div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-xl bg-white/[0.06]" /><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-white/[0.07]" /><div className="h-2.5 w-44 animate-pulse rounded bg-white/[0.04]" /></div></div>
      <div className="h-3 w-48 animate-pulse rounded bg-white/[0.05]" />
      <div className="h-3 w-16 animate-pulse rounded bg-white/[0.05]" />
      <div className="h-7 w-20 animate-pulse rounded-lg bg-white/[0.05]" />
      <div className="ml-auto h-9 w-28 animate-pulse rounded-lg bg-white/[0.05]" />
    </div>
  ));
}

export default function VoucherManagement() {
  const [templates, setTemplates] = useState([]);
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(undefined);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeCount = useMemo(
    () => templates.filter((template) => template.isActive).length,
    [templates]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [templateResponse, serviceResponse] = await Promise.all([
      getVoucherTemplatesAdmin(), getServices(),
    ]);
    if (templateResponse.ok) setTemplates(templateResponse.data?.data || []);
    else setError(templateResponse.data?.message || 'Không thể tải danh sách voucher.');
    if (serviceResponse.ok) setServices(serviceResponse.data?.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const open = (template = null) => {
    setEditing(template);
    setForm(template
      ? {
        ...template,
        serviceId: template.serviceId?._id || template.serviceId || '',
        redemptionLimit: template.redemptionLimit ?? '',
        notifyCustomers: false,
      }
      : emptyForm);
    setError('');
    setNotice('');
  };

  const save = async (event) => {
    event.preventDefault();
    if (form.type === 'FREE_SERVICE' && !form.serviceId) {
      setError('Select an active service for this voucher.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      pointCost: Number(form.pointCost),
      discountPercent: form.type === 'PERCENT_DISCOUNT' ? Number(form.discountPercent) : null,
      serviceId: form.type === 'FREE_SERVICE' ? form.serviceId : null,
      redemptionLimit: form.redemptionLimit === '' ? null : Number(form.redemptionLimit),
      notifyCustomers: !editing?._id && Boolean(form.notifyCustomers),
    };
    const response = editing?._id
      ? await updateVoucherTemplate(editing._id, payload)
      : await createVoucherTemplate(payload);
    setSaving(false);
    if (!response.ok) {
      setError(response.data?.message || 'Không thể lưu voucher template.');
      return;
    }
    setEditing(undefined);
    const notificationAcknowledged = response.data?.notification?.requested === true;
    const limitAcknowledged = payload.redemptionLimit === null
      || Number(response.data?.data?.redemptionLimit) === payload.redemptionLimit;
    if (response.data?.warning) setError(response.data.warning);
    else if (payload.notifyCustomers && !notificationAcknowledged) {
      setError('Voucher was saved, but the running backend did not process the notification. Restart the backend and try again.');
    } else if (!limitAcknowledged) {
      setError('Voucher was saved, but the running backend did not process the redemption limit. Restart the backend and try again.');
    } else {
      setNotice(notificationAcknowledged
        ? `Voucher released and sent to ${response.data.notification.sentTo} customer(s).`
        : 'Voucher saved without customer notification.');
    }
    await load();
  };

  const toggleActive = async (template) => {
    setActionId(template._id);
    setError('');
    const response = template.isActive
      ? await deactivateVoucherTemplate(template._id)
      : await updateVoucherTemplate(template._id, { isActive: true });
    setActionId('');
    if (response.ok) await load();
    else setError(response.data?.message || 'Không thể cập nhật trạng thái voucher.');
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setActionId(pendingDelete._id);
    setError('');
    const response = await deleteVoucherTemplate(pendingDelete._id);
    setActionId('');
    if (!response.ok) {
      setError(response.data?.message || 'Không thể xóa voucher template.');
      setPendingDelete(null);
      return;
    }
    setPendingDelete(null);
    await load();
  };

  const describeBenefit = (template) => template.type === 'PERCENT_DISCOUNT'
    ? `${template.discountPercent}% off booking total`
    : `Free ${template.serviceId?.name || 'selected service'}`;

  return (
    <main className="relative min-h-full overflow-hidden bg-[#080909] px-5 pb-16 pt-8 text-white sm:px-8 lg:px-10 lg:pt-10">
      <AdminBackgroundOverlay opacity="0.04" size="46px" />
      <div className="pointer-events-none absolute -right-32 -top-48 h-[34rem] w-[34rem] rounded-full bg-[#f3c43d]/[0.045] blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-56 left-1/3 h-96 w-96 rounded-full bg-[#f3c43d]/[0.025] blur-[120px]" />

      <div className="relative mx-auto max-w-[1280px]">
        <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#f3c43d]/25 bg-[#f3c43d]/[0.07] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-[#f3c43d]">
              <Gift size={13} strokeWidth={2.2} /> Loyalty rewards
            </div>
            <h1 className="text-balance text-4xl font-black tracking-[-0.045em] text-white sm:text-5xl">Voucher management</h1>
            <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-[#8992a3]">Build reward templates customers can redeem with loyalty points.</p>
          </div>
          <button type="button" onClick={() => open(null)} className="group inline-flex min-h-12 items-center justify-center gap-2.5 self-start rounded-xl bg-[#f3c43d] px-5 text-sm font-black text-[#17140a] shadow-[0_12px_35px_rgba(243,196,61,0.14)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#ffd75c] hover:shadow-[0_16px_40px_rgba(243,196,61,0.22)] focus:outline-none focus:ring-4 focus:ring-[#f3c43d]/20 active:translate-y-0 active:scale-[0.98] lg:self-auto">
            <Plus size={17} strokeWidth={2.5} className="transition-transform duration-200 group-hover:rotate-90" /> Add template
          </button>
        </header>

        <section className="mb-5 grid overflow-hidden rounded-2xl border border-white/[0.07] bg-[#101111]/85 backdrop-blur-sm sm:grid-cols-3">
          {[
            { label: 'Total templates', value: templates.length, icon: Gift },
            { label: 'Active rewards', value: activeCount, icon: Sparkles },
            { label: 'Inactive', value: Math.max(0, templates.length - activeCount), icon: Power },
          ].map(({ label, value, icon: Icon }, index) => (
            <div key={label} className={`flex items-center gap-4 px-5 py-4 ${index ? 'border-t border-white/[0.06] sm:border-l sm:border-t-0' : ''}`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.045] text-[#f3c43d]"><Icon size={17} strokeWidth={1.8} /></div>
              <div><p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/35">{label}</p><p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-white">{loading ? '—' : value}</p></div>
            </div>
          ))}
        </section>

        {error && (
          <div role="alert" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3.5 text-sm font-semibold text-rose-200">
            <span className="flex items-center gap-2.5"><AlertCircle size={17} className="shrink-0" />{error}</span>
            <button type="button" onClick={() => setError('')} className="text-rose-200/60 transition hover:text-rose-100" aria-label="Dismiss error"><X size={16} /></button>
          </div>
        )}

        {notice && (
          <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-3.5 text-sm font-semibold text-emerald-200">
            <span className="flex items-center gap-2.5"><Check size={17} className="shrink-0" />{notice}</span>
            <button type="button" onClick={() => setNotice('')} className="text-emerald-200/60 transition hover:text-emerald-100" aria-label="Dismiss message"><X size={16} /></button>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0e0e]/90 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-sm">
          <div className="hidden grid-cols-[minmax(240px,1.4fr)_minmax(240px,1.7fr)_140px_130px_150px] gap-5 border-b border-white/[0.08] bg-white/[0.025] px-5 py-3.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#778092] lg:grid">
            <span>Template</span><span>Customer benefit</span><span>Point cost</span><span>Status</span><span className="text-right">Actions</span>
          </div>

          {loading ? (
            <div className="hidden lg:block"><VoucherSkeleton /></div>
          ) : templates.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#f3c43d]/15 bg-[#f3c43d]/[0.06] text-[#f3c43d]"><Gift size={26} strokeWidth={1.6} /></div>
              <h2 className="text-xl font-black tracking-tight">No reward templates yet</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/40">Create a percentage discount or a free-service voucher for customers to redeem.</p>
              <button type="button" onClick={() => open(null)} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[#f3c43d]/25 px-4 py-2.5 text-sm font-bold text-[#f3c43d] transition hover:bg-[#f3c43d]/10 focus:outline-none focus:ring-2 focus:ring-[#f3c43d]/30"><Plus size={16} /> Create first template</button>
            </div>
          ) : (
            <div>
              {templates.map((template) => (
                <article key={template._id} className={`group grid gap-4 border-t border-white/[0.06] px-5 py-4 transition duration-200 first:border-t-0 hover:bg-white/[0.022] lg:grid-cols-[minmax(240px,1.4fr)_minmax(240px,1.7fr)_140px_130px_150px] lg:items-center lg:gap-5 ${template.isActive ? '' : 'opacity-60 hover:opacity-80'}`}>
                  <div className="flex min-w-0 items-center gap-3.5"><BenefitMark template={template} /><div className="min-w-0"><h2 className="truncate text-sm font-black tracking-[-0.01em] text-white">{template.name}</h2><p className="mt-1 truncate text-xs font-medium text-white/35">{template.description || 'No description provided'}</p></div></div>
                  <div className="flex items-center justify-between gap-4 lg:block"><span className="text-[10px] font-black uppercase tracking-widest text-white/30 lg:hidden">Benefit</span><p className="text-sm font-semibold text-[#d8dbe1]">{describeBenefit(template)}</p></div>
                  <div className="flex items-center justify-between gap-4 lg:block"><span className="text-[10px] font-black uppercase tracking-widest text-white/30 lg:hidden">Point cost</span><div><p className="flex items-center gap-2 font-mono text-sm font-bold tabular-nums text-[#f3c43d]"><Coins size={15} />{template.pointCost.toLocaleString('vi-VN')}</p><p className="mt-1 text-[10px] font-bold text-white/35">{template.redemptionLimit ? `${Number(template.redeemedCount || 0).toLocaleString('vi-VN')} / ${template.redemptionLimit.toLocaleString('vi-VN')} redeemed` : 'Unlimited quantity'}</p></div></div>
                  <div className="flex items-center justify-between gap-4 lg:block"><span className="text-[10px] font-black uppercase tracking-widest text-white/30 lg:hidden">Status</span><span className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${template.isActive ? 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300' : 'border-white/10 bg-white/[0.035] text-white/40'}`}><span className={`h-1.5 w-1.5 rounded-full ${template.isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-white/30'}`} />{template.isActive ? 'Active' : 'Inactive'}</span></div>
                  <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-3 lg:border-0 lg:pt-0">
                    <button type="button" onClick={() => open(template)} className={`${actionClass} border-white/[0.07] bg-white/[0.035] text-[#aeb6c5] hover:border-white/15 hover:bg-white/[0.07] hover:text-white`} title="Edit template" aria-label={`Edit ${template.name}`}><Edit2 size={15} /></button>
                    <button type="button" onClick={() => toggleActive(template)} disabled={actionId === template._id} className={`${actionClass} ${template.isActive ? 'border-[#f3c43d]/15 bg-[#f3c43d]/[0.07] text-[#f3c43d] hover:bg-[#f3c43d]/15' : 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300 hover:bg-emerald-400/15'}`} title={template.isActive ? 'Deactivate template' : 'Activate template'} aria-label={`${template.isActive ? 'Deactivate' : 'Activate'} ${template.name}`}>{actionId === template._id ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}</button>
                    <button type="button" onClick={() => setPendingDelete(template)} disabled={actionId === template._id} className={`${actionClass} border-rose-400/10 bg-rose-400/[0.055] text-rose-300/80 hover:border-rose-400/20 hover:bg-rose-400/10 hover:text-rose-200`} title="Delete template" aria-label={`Delete ${template.name}`}><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {loading && <div className="space-y-3 p-4 lg:hidden">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>}
        </section>
      </div>

      {editing !== undefined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditing(undefined); }}>
          <form onSubmit={save} className="relative w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/[0.1] bg-[#101111] shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f3c43d]/70 to-transparent" />
            <div className="flex items-start justify-between border-b border-white/[0.07] px-6 py-5">
              <div className="flex items-center gap-3.5"><BenefitMark template={form} large /><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#f3c43d]">Reward template</p><h2 className="mt-1 text-xl font-black tracking-tight text-white">{editing?._id ? 'Edit voucher' : 'Create voucher'}</h2></div></div>
              <button type="button" onClick={() => setEditing(undefined)} disabled={saving} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/35 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20" aria-label="Close dialog"><X size={19} /></button>
            </div>
            <div className="grid gap-5 p-6 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="text-xs font-bold text-white/55">Template name</span><input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} placeholder="e.g. Weekend 15% off" /></label>
              <label className="sm:col-span-2"><span className="text-xs font-bold text-white/55">Description <span className="font-medium text-white/25">(optional)</span></span><textarea rows={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${fieldClass} resize-none`} placeholder="Explain when and how customers can use this reward." /></label>
              <div><span className="text-xs font-bold text-white/55">Reward type</span><AdminSelect value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={rewardTypeOptions} ariaLabel="Select reward type" icon={Gift} className="mt-2 w-full" buttonClassName="h-[46px] border-white/[0.09] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] hover:border-[#f3c43d]/35 hover:bg-white/[0.05]" menuClassName="w-full border-white/[0.1] bg-[#151616] shadow-[0_20px_55px_rgba(0,0,0,0.55)]" /></div>
              <label><span className="text-xs font-bold text-white/55">Point cost</span><div className="relative"><input type="number" min="1" required value={form.pointCost} onChange={(event) => setForm({ ...form, pointCost: event.target.value })} className={`${fieldClass} ${numberFieldClass} pr-16 font-mono tabular-nums`} /><span className="pointer-events-none absolute bottom-3 right-3 text-[10px] font-black uppercase tracking-widest text-white/25">points</span></div></label>
              <label><span className="text-xs font-bold text-white/55">Redemption limit <span className="font-medium text-white/25">(optional)</span></span><div className="relative"><input type="number" min={Math.max(1, Number(editing?.redeemedCount || 0))} step="1" value={form.redemptionLimit} onChange={(event) => setForm({ ...form, redemptionLimit: event.target.value })} className={`${fieldClass} ${numberFieldClass} pr-20 font-mono tabular-nums`} placeholder="Unlimited" /><span className="pointer-events-none absolute bottom-3 right-3 text-[10px] font-black uppercase tracking-widest text-white/25">vouchers</span></div><p className="mt-1.5 text-[10px] font-medium text-white/30">Leave empty for unlimited availability.{editing?.redeemedCount ? ` Already redeemed: ${editing.redeemedCount}.` : ''}</p></label>
              {form.type === 'PERCENT_DISCOUNT' ? (
                <label className="sm:col-span-2"><span className="text-xs font-bold text-white/55">Discount percentage</span><div className="relative"><input type="number" min="1" max="100" required value={form.discountPercent} onChange={(event) => setForm({ ...form, discountPercent: event.target.value })} className={`${fieldClass} ${numberFieldClass} pr-12 font-mono tabular-nums`} /><Percent size={15} className="pointer-events-none absolute bottom-3.5 right-3 text-white/25" /></div></label>
              ) : (
                <div className="sm:col-span-2"><span className="text-xs font-bold text-white/55">Included service</span><AdminSelect value={form.serviceId} onChange={(value) => setForm({ ...form, serviceId: value })} options={[{ value: '', label: 'Select an active service', disabled: true }, ...services.map((service) => ({ value: service._id, label: `${service.name} · ${Number(service.price || 0).toLocaleString('vi-VN')} VND` }))]} ariaLabel="Select included service" icon={Wrench} className="mt-2 w-full" buttonClassName="h-[46px] border-white/[0.09] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] hover:border-[#f3c43d]/35 hover:bg-white/[0.05]" menuClassName="w-full border-white/[0.1] bg-[#151616] shadow-[0_20px_55px_rgba(0,0,0,0.55)]" visibleItems={5} /></div>
              )}
              {!editing?._id && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.notifyCustomers}
                  onClick={() => setForm({ ...form, notifyCustomers: !form.notifyCustomers })}
                  className="sm:col-span-2 flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5 text-left transition hover:border-white/[0.14] hover:bg-white/[0.04]"
                >
                  <span className="flex items-start gap-3"><Bell size={17} className="mt-0.5 shrink-0 text-[#f3c43d]" /><span><span className="block text-xs font-black text-white">Notify customers on release</span><span className="mt-1 block text-[11px] leading-4 text-white/35">Send a promotion notification linking directly to Rewards.</span></span></span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${form.notifyCustomers ? 'bg-[#f3c43d]' : 'bg-white/10'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.notifyCustomers ? 'translate-x-6' : 'translate-x-1'}`} /></span>
                </button>
              )}
              <div className="sm:col-span-2 rounded-xl border border-[#f3c43d]/15 bg-[#f3c43d]/[0.045] px-4 py-3.5">
                <div className="flex items-start gap-3"><Sparkles size={16} className="mt-0.5 shrink-0 text-[#f3c43d]" /><div><p className="text-xs font-black text-white">Customer preview</p><p className="mt-1 text-xs leading-5 text-white/45">{form.name || 'Untitled reward'} · {form.type === 'PERCENT_DISCOUNT' ? `${form.discountPercent || 0}% off the booking total` : 'one selected service at no charge'} · {Number(form.pointCost || 0).toLocaleString('vi-VN')} points</p></div></div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-white/[0.07] bg-black/10 px-6 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setEditing(undefined)} disabled={saving} className="min-h-11 rounded-xl border border-white/[0.09] px-5 text-sm font-bold text-white/60 transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 active:scale-[0.98]">Cancel</button>
              <button disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f3c43d] px-6 text-sm font-black text-[#17140a] transition hover:bg-[#ffd75c] focus:outline-none focus:ring-4 focus:ring-[#f3c43d]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{saving ? <><Loader2 size={16} className="animate-spin" />Saving</> : <><Check size={16} strokeWidth={2.6} />Save template</>}</button>
            </div>
          </form>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionId) setPendingDelete(null); }}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-voucher-title" className="w-full max-w-md rounded-3xl border border-white/[0.1] bg-[#111212] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/15 bg-rose-400/[0.07] text-rose-300"><Trash2 size={20} /></div>
            <h2 id="delete-voucher-title" className="mt-5 text-xl font-black tracking-tight">Delete “{pendingDelete.name}”?</h2>
            <p className="mt-2 text-sm leading-6 text-white/45">This removes the template permanently. Templates with available customer vouchers cannot be deleted.</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPendingDelete(null)} disabled={Boolean(actionId)} className="min-h-11 rounded-xl border border-white/[0.09] px-4 text-sm font-bold text-white/60 transition hover:bg-white/[0.05] hover:text-white">Keep template</button><button type="button" onClick={remove} disabled={Boolean(actionId)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-500 px-4 text-sm font-black text-white transition hover:bg-rose-400 focus:outline-none focus:ring-4 focus:ring-rose-400/20 active:scale-[0.98] disabled:opacity-50">{actionId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}Delete</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
