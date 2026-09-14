import { useEffect, useState } from 'react';
import { AlertCircle, Check, Edit2, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  approveSuggestion,
  createPricingRule,
  deletePricingRule,
  getCurrentPricing,
  getPricingConfig,
  getPricingHistory,
  getPricingRules,
  getPricingStats,
  getSuggestions,
  rejectSuggestion,
  updatePricingConfig,
  updatePricingRule,
} from '../../services/pricingService';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;
const inputClass = 'w-full rounded-xl border border-white/10 bg-[#171717] px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-gold focus:ring-1 focus:ring-gold/40';
const panelClass = 'rounded-2xl border border-white/10 bg-white/[0.035] p-5';

function Notice({ error, success }) {
  if (!error && !success) return null;
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${
      error ? 'border-red-500/20 bg-red-500/10 text-red-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    }`}>
      {error ? <AlertCircle size={16} /> : <Check size={16} />}{error || success}
    </div>
  );
}

function LoadingState() {
  return <div className="flex min-h-56 items-center justify-center"><Loader2 className="animate-spin text-gold" /></div>;
}

function ConfigTab() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    getPricingConfig().then((response) => {
      if (!active) return;
      if (response.ok && response.data?.data) setForm(response.data.data);
      else setError(response.data?.message || 'Unable to load dynamic pricing configuration.');
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setError('');
    setSuccess('');
    if (form.triggerThreshold < 1 || form.triggerThreshold > 50) {
      setError('Trigger threshold must be between 1 and 50.');
      return;
    }
    if (form.rejectionCooldownMinutes < 1 || form.suggestionExpiryMinutes < 1) {
      setError('Cooldown and expiry must be at least 1 minute.');
      return;
    }
    setSaving(true);
    const response = await updatePricingConfig({
      isEnabled: form.isEnabled,
      pricingMode: form.pricingMode,
      triggerThreshold: Number(form.triggerThreshold),
      rejectionCooldownMinutes: Number(form.rejectionCooldownMinutes),
      suggestionExpiryMinutes: Number(form.suggestionExpiryMinutes),
    });
    if (response.ok && response.data?.data) {
      setForm(response.data.data);
      setSuccess('Dynamic pricing configuration saved.');
    } else setError(response.data?.message || 'Unable to save configuration.');
    setSaving(false);
  };

  if (loading) return <LoadingState />;
  if (!form) return <Notice error={error} />;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <div>
      <Notice error={error} success={success} />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={panelClass}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Dynamic pricing engine</h2>
              <p className="mt-1 text-sm text-blue-100/55">Enable demand-aware pricing across bookings and memberships.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(form.isEnabled)}
              onClick={() => setField('isEnabled', !form.isEnabled)}
              className={`relative h-7 w-14 rounded-full transition ${form.isEnabled ? 'bg-gold' : 'bg-white/15'}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${form.isEnabled ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          <label className="mt-6 block text-xs font-black uppercase tracking-wider text-blue-100/55">Operating mode</label>
          <select value={form.pricingMode} onChange={(event) => setField('pricingMode', event.target.value)} className={`${inputClass} mt-2`}>
            <option value="manual">Manual</option>
            <option value="semi-auto">Semi-auto</option>
            <option value="auto">Auto</option>
          </select>
        </section>

        <section className={`${panelClass} grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3`}>
          {[
            ['triggerThreshold', 'Trigger threshold', 1, 50],
            ['rejectionCooldownMinutes', 'Reject cooldown', 1, undefined],
            ['suggestionExpiryMinutes', 'Suggestion expiry', 1, undefined],
          ].map(([field, label, min, max]) => (
            <label key={field} className="block">
              <span className="text-xs font-black uppercase tracking-wider text-blue-100/55">{label}</span>
              <input type="number" min={min} max={max} value={form[field]} onChange={(event) => setField(field, Number(event.target.value))} className={`${inputClass} mt-2`} />
              <span className="mt-1 block text-[11px] text-blue-100/40">{field === 'triggerThreshold' ? 'score points' : 'minutes'}</span>
            </label>
          ))}
        </section>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-black text-black disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'Saving...' : 'Save configuration'}
        </button>
      </div>
    </div>
  );
}

const emptyRule = { label: '', minScore: 0, maxScore: 35, multiplier: 1, priceType: 'hourly', packageId: '', isActive: true };

function RuleModal({ rule, packages, onClose, onSaved }) {
  const [form, setForm] = useState(rule ? { ...rule, packageId: rule.packageId?._id || rule.packageId || '' } : emptyRule);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.label.trim()) return setError('Label is required.');
    if (form.minScore < 0 || form.minScore > 99 || form.maxScore < 1 || form.maxScore > 100 || form.minScore >= form.maxScore) {
      return setError('Score range must satisfy 0 ≤ minScore < maxScore ≤ 100.');
    }
    if (form.multiplier < 0.5 || form.multiplier > 3) return setError('Multiplier must be between 0.5 and 3.0.');
    setSaving(true);
    const payload = {
      label: form.label.trim(), minScore: Number(form.minScore), maxScore: Number(form.maxScore),
      multiplier: Number(form.multiplier), priceType: form.priceType,
      packageId: form.priceType === 'package' && form.packageId ? form.packageId : null,
      isActive: Boolean(form.isActive),
    };
    const response = rule ? await updatePricingRule(rule._id, payload) : await createPricingRule(payload);
    setSaving(false);
    if (!response.ok) return setError(response.data?.message || 'Unable to save pricing rule.');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#101010] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-black text-white">{rule ? 'Edit rule' : 'Add pricing rule'}</h2><button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X /></button></div>
        <Notice error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="text-xs font-bold text-blue-100/55">Label</span><input required value={form.label} onChange={(event) => setField('label', event.target.value)} className={`${inputClass} mt-1`} /></label>
          <label><span className="text-xs font-bold text-blue-100/55">Minimum score</span><input type="number" min="0" max="99" value={form.minScore} onChange={(event) => setField('minScore', Number(event.target.value))} className={`${inputClass} mt-1`} /></label>
          <label><span className="text-xs font-bold text-blue-100/55">Maximum score</span><input type="number" min="1" max="100" value={form.maxScore} onChange={(event) => setField('maxScore', Number(event.target.value))} className={`${inputClass} mt-1`} /></label>
          <label><span className="text-xs font-bold text-blue-100/55">Multiplier</span><input type="number" min="0.5" max="3" step="0.05" value={form.multiplier} onChange={(event) => setField('multiplier', Number(event.target.value))} className={`${inputClass} mt-1`} /></label>
          <label><span className="text-xs font-bold text-blue-100/55">Price type</span><select value={form.priceType} onChange={(event) => setField('priceType', event.target.value)} className={`${inputClass} mt-1`}><option value="hourly">Hourly</option><option value="package">Package</option><option value="all">All</option></select></label>
          {form.priceType === 'package' && <label className="sm:col-span-2"><span className="text-xs font-bold text-blue-100/55">Package (blank applies to all)</span><select value={form.packageId || ''} onChange={(event) => setField('packageId', event.target.value)} className={`${inputClass} mt-1`}><option value="">All packages</option>{packages.map((pkg) => <option key={pkg._id} value={pkg._id}>{pkg.name}</option>)}</select></label>}
          <label className="flex items-center gap-2 text-sm font-bold text-white"><input type="checkbox" checked={form.isActive} onChange={(event) => setField('isActive', event.target.checked)} /> Active</label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-white">Cancel</button><button disabled={saving} className="rounded-xl bg-gold px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">{saving ? 'Saving...' : 'Save rule'}</button></div>
      </form>
    </div>
  );
}

function RulesTab() {
  const [rules, setRules] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [togglingRuleId, setTogglingRuleId] = useState(null);
  const load = async () => {
    setLoading(true);
    const [ruleResponse, pricingResponse] = await Promise.all([getPricingRules(), getCurrentPricing()]);
    if (ruleResponse.ok) setRules(ruleResponse.data?.data || []);
    else setError(ruleResponse.data?.message || 'Unable to load pricing rules.');
    if (pricingResponse.ok) setPackages(pricingResponse.data?.data?.packages || []);
    setLoading(false);
  };
  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, []);
  const remove = async (rule) => {
    if (!window.confirm(`Delete pricing rule “${rule.label}”?`)) return;
    const response = await deletePricingRule(rule._id);
    if (response.ok) setRules((current) => current.filter((item) => item._id !== rule._id));
    else setError(response.data?.message || 'Unable to delete rule.');
  };
  const toggleActive = async (rule) => {
    setError('');
    setTogglingRuleId(rule._id);
    const response = await updatePricingRule(rule._id, { isActive: !rule.isActive });
    if (response.ok && response.data?.data) {
      setRules((current) => current.map((item) => (
        item._id === rule._id ? { ...item, ...response.data.data } : item
      )));
    } else {
      setError(response.data?.message || `Unable to ${rule.isActive ? 'deactivate' : 'activate'} rule.`);
    }
    setTogglingRuleId(null);
  };
  if (loading) return <LoadingState />;
  return (
    <div>
      <Notice error={error} />
      <div className="mb-4 flex justify-between"><div><h2 className="text-xl font-black text-white">Pricing rules</h2><p className="text-sm text-blue-100/55">Map forecast score ranges to price multipliers.</p></div><button onClick={() => setEditing(null)} className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-black text-black"><Plus size={16} /> Add rule</button></div>
      <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase tracking-wider text-blue-100/50"><tr><th className="p-4">Label</th><th>Score</th><th>Multiplier</th><th>Type</th><th>Status</th><th className="pr-4 text-right">Actions</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule._id} className="border-t border-white/10 text-white"><td className="p-4 font-bold">{rule.label}</td><td>{rule.minScore}–{rule.maxScore}</td><td className="font-mono font-black text-gold">×{rule.multiplier}</td><td className="capitalize">{rule.priceType}</td><td><button type="button" role="switch" aria-checked={rule.isActive} aria-label={`${rule.isActive ? 'Deactivate' : 'Activate'} ${rule.label}`} disabled={togglingRuleId === rule._id} onClick={() => toggleActive(rule)} className={`inline-flex min-w-[104px] items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-black transition disabled:cursor-wait disabled:opacity-60 ${rule.isActive ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-white/45'}`}>{togglingRuleId === rule._id ? <Loader2 size={14} className="animate-spin" /> : <span className={`relative h-4 w-8 rounded-full transition ${rule.isActive ? 'bg-emerald-400' : 'bg-white/20'}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${rule.isActive ? 'left-[18px]' : 'left-0.5'}`} /></span>}<span>{rule.isActive ? 'Active' : 'Inactive'}</span></button></td><td className="pr-4"><div className="flex justify-end gap-2"><button onClick={() => setEditing(rule)} className="rounded-lg bg-white/5 p-2 text-blue-200 hover:bg-white/10"><Edit2 size={15} /></button><button onClick={() => remove(rule)} className="rounded-lg bg-red-500/10 p-2 text-red-300 hover:bg-red-500/20"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>{rules.length === 0 && <p className="p-8 text-center text-blue-100/45">No pricing rules configured.</p>}</div>
      {editing !== undefined && <RuleModal rule={editing} packages={packages} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />}
    </div>
  );
}

const statusTone = { pending: 'text-yellow-300', approved: 'text-emerald-300', rejected: 'text-red-300', expired: 'text-white/40' };

function SuggestionsTab() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    const response = await getSuggestions(status ? { status } : {});
    if (response.ok) setItems(response.data?.data || []);
    else setError(response.data?.message || 'Unable to load suggestions.');
    setLoading(false);
  };
  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const review = async (item, action) => {
    setError('');
    const response = action === 'approve' ? await approveSuggestion(item._id) : await rejectSuggestion(item._id);
    if (!response.ok) return setError(response.data?.message || `Unable to ${action} suggestion.`);
    const updated = response.data?.data?.suggestion || response.data?.data;
    setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, ...updated } : entry));
  };
  return (
    <div>
      <Notice error={error} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-black text-white">AI suggestions</h2><p className="text-sm text-blue-100/55">Review proposed prices generated in semi-auto mode.</p></div><label><span className="mb-1 block text-xs font-bold text-blue-100/50">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option></select></label></div>
      {loading ? <LoadingState /> : <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase text-blue-100/50"><tr><th className="p-4">Type</th><th>Price</th><th>Demand</th><th>Status</th><th>Valid until</th><th className="pr-4 text-right">Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item._id} className="border-t border-white/10 text-white"><td className="p-4 capitalize">{item.priceType}</td><td><span className="text-white/40 line-through">{money(item.basePrice)}</span><span className="ml-2 font-black text-gold">{money(item.suggestedPrice)}</span></td><td>{item.busynessScore}/100 <span className="capitalize text-blue-100/50">· {item.level}</span></td><td className={`capitalize font-bold ${statusTone[item.status]}`}>{item.status}</td><td>{new Date(item.validUntil).toLocaleString('vi-VN')}</td><td className="pr-4"><div className="flex justify-end gap-2"><button disabled={item.status !== 'pending'} onClick={() => review(item, 'approve')} className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 disabled:opacity-30">Approve</button><button disabled={item.status !== 'pending'} onClick={() => review(item, 'reject')} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-30">Reject</button></div></td></tr>)}</tbody></table>{items.length === 0 && <p className="p-8 text-center text-blue-100/45">No suggestions found.</p>}</div>}
    </div>
  );
}

function HistoryTab() {
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const [historyResponse, statsResponse] = await Promise.all([getPricingHistory(query), getPricingStats(query)]);
      if (!active) return;
      if (historyResponse.ok) { setHistory(historyResponse.data?.data || []); setHistoryError(''); }
      else setHistoryError(historyResponse.data?.message || 'Unable to load price history.');
      if (statsResponse.ok) { setStats(statsResponse.data?.data || null); setStatsError(''); }
      else setStatsError(statsResponse.data?.message || 'Unable to load pricing statistics.');
      setLoading(false);
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [filters]);
  const distribution = stats?.distributionByLevel || {};
  return (
    <div>
      <Notice error={statsError} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className={`${panelClass} sm:col-span-1 lg:col-span-2`}><p className="text-xs uppercase text-blue-100/45">Adjustments</p><p className="mt-2 text-3xl font-black text-white">{stats?.adjustmentCount ?? '—'}</p></div>
        <div className={`${panelClass} sm:col-span-1 lg:col-span-2`}><p className="text-xs uppercase text-blue-100/45">Average change</p><p className="mt-2 text-3xl font-black text-gold">{stats ? `${stats.averageAdjustmentPercent}%` : '—'}</p></div>
        <div className={`${panelClass} sm:col-span-2 lg:col-span-2`}><p className="text-xs uppercase text-blue-100/45">Demand distribution</p><div className="mt-3 flex flex-wrap gap-3 text-sm font-bold text-white"><span>Low {distribution.low || 0}</span><span>Moderate {distribution.moderate || 0}</span><span>High {distribution.high || 0}</span><span>Peak {distribution.peak || 0}</span></div></div>
      </div>
      <Notice error={historyError} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><h2 className="text-xl font-black text-white">Price history</h2><div className="flex gap-2"><label><span className="mb-1 block text-xs text-blue-100/50">From</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} className={inputClass} /></label><label><span className="mb-1 block text-xs text-blue-100/50">To</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} className={inputClass} /></label></div></div>
      {loading ? <LoadingState /> : <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase text-blue-100/50"><tr><th className="p-4">Date</th><th>Type</th><th>Old</th><th>New</th><th>Demand</th><th>Level</th><th>Adjustment</th></tr></thead><tbody>{history.map((item) => <tr key={item._id} className="border-t border-white/10 text-white"><td className="p-4">{new Date(item.createdAt).toLocaleString('vi-VN')}</td><td className="capitalize">{item.priceType}</td><td>{money(item.oldPrice)}</td><td className="font-black text-gold">{money(item.newPrice)}</td><td>{item.busynessScore}</td><td className="capitalize">{item.level}</td><td className="capitalize">{String(item.adjustmentType).replaceAll('_', ' ')}</td></tr>)}</tbody></table>{history.length === 0 && <p className="p-8 text-center text-blue-100/45">No price history found.</p>}</div>}
    </div>
  );
}

export default function DynamicPricingAdminTabs({ activeTab }) {
  if (activeTab === 'dynamic') return <ConfigTab />;
  if (activeTab === 'rules') return <RulesTab />;
  if (activeTab === 'suggestions') return <SuggestionsTab />;
  if (activeTab === 'history') return <HistoryTab />;
  return null;
}
