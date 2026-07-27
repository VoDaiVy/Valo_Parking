import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  Plus,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import RefundRuleEditor from '../../components/policies/RefundRuleEditor';
import RefundRulePreview from '../../components/policies/RefundRulePreview';
import AdminSelect from '../../components/Admin/AdminSelect';
import ConfirmModal from '../../components/Admin/ConfirmModal';
import {
  createDefaultRefundRule,
  createPolicy,
  createPolicyVersion,
  deletePolicy,
  getAdminPolicies,
  getAdminPolicy,
  getPolicyAcceptances,
  publishPolicyVersion,
  normalizeRefundRule,
  updatePolicy,
  updatePolicyVersion,
  validateRefundRule,
} from '../../services/policyService';

const categories = [
  ['terms', 'Terms'],
  ['privacy', 'Privacy'],
  ['refund', 'Refund'],
  ['parking_rules', 'Parking rules'],
  ['safety', 'Safety'],
  ['other', 'Other'],
];

const emptyCreateForm = {
  title: '',
  slug: '',
  category: 'terms',
  description: '',
  requiresAcceptance: true,
  controlsBookingRefunds: false,
  summary: '',
  content: '',
  effectiveDate: '',
  changeNote: '',
  refundRule: null,
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      })
    : '-';

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const statusClass = (status) => {
  if (status === 'published') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  if (status === 'archived') return 'border-gray-500/20 bg-gray-500/10 text-gray-300';
  return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
};

const categoryLabel = (value) =>
  categories.find(([key]) => key === value)?.[1] || value || 'Other';

const inputClass =
  'w-full border border-white/[0.08] bg-black/45 px-4 py-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-yellow-400/60 focus:bg-black/70';
const labelClass =
  'mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-gray-500';
const scrollbarClass =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-yellow-400/40';

const tabs = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'draft', label: 'Draft', icon: FileText },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'acceptances', label: 'Acceptances', icon: Users },
];

const policyStatusOptions = [
  { value: 'all', label: 'All Status' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const policySortOptions = [
  { value: 'updated', label: 'Sort Updated' },
  { value: 'title', label: 'Sort Title' },
  { value: 'version', label: 'Sort Version' },
];

const categoryOptions = categories.map(([value, label]) => ({ value, label }));

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${statusClass(status)}`}>
      {status || 'draft'}
    </span>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">
      {children}
    </p>
  );
}

function PremiumButton({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  variant = 'primary',
}) {
  const styles = {
    primary:
      'group relative overflow-hidden border-yellow-300/30 bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-600 text-black shadow-[0_0_36px_rgba(234,179,8,0.16)] hover:shadow-[0_0_42px_rgba(234,179,8,0.26)]',
    ghost:
      'border-white/[0.09] bg-white/[0.03] text-gray-200 hover:border-yellow-400/30 hover:bg-yellow-400/[0.06] hover:text-yellow-200',
    danger:
      'border-red-500/25 bg-red-500/[0.04] text-red-300 hover:border-red-400/40 hover:bg-red-500/10',
    light:
      'border-white/70 bg-white text-black hover:bg-gray-200',
  };

  return (
    <motion.button
      type={type}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[14px] border px-4 py-2.5 text-sm font-black transition disabled:pointer-events-none disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {variant === 'primary' && (
        <span className="pointer-events-none absolute inset-y-0 -left-10 w-8 rotate-12 bg-white/40 opacity-0 blur-sm transition-all duration-500 group-hover:left-[115%] group-hover:opacity-70" />
      )}
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </motion.button>
  );
}

function InfoLine({ label, value, children }) {
  return (
    <div className="grid gap-2 border-b border-white/[0.07] py-4 md:grid-cols-[180px_1fr]">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-sm font-semibold text-gray-200">{children || value || '-'}</div>
    </div>
  );
}

export default function PolicyManagement() {
  const [policies, setPolicies] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', isDestructive: false, action: null });
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [metadata, setMetadata] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [createRuleErrors, setCreateRuleErrors] = useState({});
  const [draftRuleErrors, setDraftRuleErrors] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('updated');
  const [activeTab, setActiveTab] = useState('overview');
  const [acceptances, setAcceptances] = useState([]);
  const [acceptanceMeta, setAcceptanceMeta] = useState(null);
  const [acceptancesLoading, setAcceptancesLoading] = useState(false);
  const [acceptancesError, setAcceptancesError] = useState('');
  const reduceMotion = useReducedMotion();

  const selectedPolicy = detail?.policy;
  const versions = useMemo(() => detail?.versions || [], [detail?.versions]);
  const activeDraft = useMemo(
    () => versions.find((version) => version.status === 'draft') || null,
    [versions]
  );

  const motionProps = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.42, ease: 'easeOut' },
      };

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchPolicies = async () => {
    const res = await getAdminPolicies();
    if (res.ok && res.data?.success) {
      setPolicies(res.data.data || []);
    } else {
      setError(res.data?.message || 'Unable to load policies.');
    }
  };

  const loadDetail = async (id) => {
    if (!id) return;
    setDetailLoading(true);
    setError('');
    const res = await getAdminPolicy(id);
    if (res.ok && res.data?.success) {
      const nextDetail = res.data.data;
      setDetail(nextDetail);
      setMetadata({
        title: nextDetail.policy.title || '',
        slug: nextDetail.policy.slug || '',
        category: nextDetail.policy.category || 'other',
        description: nextDetail.policy.description || '',
        requiresAcceptance: Boolean(nextDetail.policy.requiresAcceptance),
        controlsBookingRefunds: Boolean(nextDetail.policy.controlsBookingRefunds),
      });

      const nextDraft = nextDetail.versions.find((version) => version.status === 'draft') || null;
      setDraft(
        nextDraft
          ? {
              title: nextDraft.title || '',
              summary: nextDraft.summary || '',
              content: nextDraft.content || '',
              effectiveDate: nextDraft.effectiveDate
                ? new Date(nextDraft.effectiveDate).toISOString().slice(0, 10)
                : '',
              changeNote: nextDraft.changeNote || '',
              refundRule: nextDetail.policy.controlsBookingRefunds
                ? normalizeRefundRule(nextDraft.refundRule)
                : null,
            }
          : null
      );
      setDraftRuleErrors({});
    } else {
      setError(res.data?.message || 'Unable to load policy details.');
    }
    setDetailLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPolicies().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    let ignore = false;
    const loadAcceptances = async () => {
      if (!selectedPolicy?._id || activeTab !== 'acceptances') return;
      setAcceptancesLoading(true);
      setAcceptancesError('');
      const res = await getPolicyAcceptances(selectedPolicy._id, { limit: 50 });
      if (ignore) return;
      if (res.ok && res.data?.success) {
        setAcceptances(res.data.data?.items || []);
        setAcceptanceMeta(res.data.data?.pagination || null);
      } else {
        setAcceptances([]);
        setAcceptanceMeta(null);
        setAcceptancesError(res.data?.message || 'Unable to load acceptance records.');
      }
      setAcceptancesLoading(false);
    };

    loadAcceptances();
    return () => {
      ignore = true;
    };
  }, [activeTab, selectedPolicy?._id]);

  const handleCreate = async (event) => {
    event.preventDefault();
    const ruleErrors = createForm.controlsBookingRefunds
      ? validateRefundRule(createForm.refundRule)
      : {};
    setCreateRuleErrors(ruleErrors);
    if (Object.keys(ruleErrors).length > 0) {
      setError('Please fix the refund rule errors before creating this policy.');
      return;
    }

    setSaving(true);
    setError('');
    const payload = {
      ...createForm,
      refundRule: createForm.controlsBookingRefunds
        ? normalizeRefundRule(createForm.refundRule)
        : undefined,
    };
    const res = await createPolicy(payload);
    if (res.ok && res.data?.success) {
      showToast('Draft created');
      setCreateForm(emptyCreateForm);
      setIsCreating(false);
      await fetchPolicies();
      setSelectedId(res.data.data._id);
      setActiveTab('draft');
    } else {
      setError(res.data?.message || 'Unable to create policy.');
    }
    setSaving(false);
  };

  const handleMetadataSave = async () => {
    if (!selectedPolicy) return;
    setSaving(true);
    setError('');
    const res = await updatePolicy(selectedPolicy._id, metadata);
    if (res.ok && res.data?.success) {
      showToast('Policy metadata saved');
      await fetchPolicies();
      await loadDetail(selectedPolicy._id);
    } else {
      setError(res.data?.message || 'Unable to save metadata.');
    }
    setSaving(false);
  };

  const handleDraftSave = async () => {
    if (!selectedPolicy || !activeDraft) return;
    const ruleErrors = selectedPolicy.controlsBookingRefunds
      ? validateRefundRule(draft?.refundRule)
      : {};
    setDraftRuleErrors(ruleErrors);
    if (Object.keys(ruleErrors).length > 0) {
      setError('Please fix the refund rule errors before saving this draft.');
      return;
    }

    setSaving(true);
    setError('');
    const payload = {
      ...draft,
      refundRule: selectedPolicy.controlsBookingRefunds
        ? normalizeRefundRule(draft.refundRule)
        : undefined,
    };
    const res = await updatePolicyVersion(selectedPolicy._id, activeDraft._id, payload);
    if (res.ok && res.data?.success) {
      showToast('Draft saved');
      await loadDetail(selectedPolicy._id);
    } else {
      setError(res.data?.message || 'Unable to save draft.');
    }
    setSaving(false);
  };

  const handleCreateNextDraft = async () => {
    if (!selectedPolicy) return;
    setSaving(true);
    setError('');
    const current = selectedPolicy.currentVersion || {};
    const currentPublishedVersion = versions.find(
      (version) =>
        version.status === 'published' &&
        version.versionNumber === selectedPolicy.currentVersionNumber
    );
    const res = await createPolicyVersion(selectedPolicy._id, {
      title: current.title || selectedPolicy.title,
      summary: current.summary || '',
      content: current.content || '',
      effectiveDate: current.effectiveDate,
      refundRule: selectedPolicy.controlsBookingRefunds
        ? normalizeRefundRule(current.refundRule || currentPublishedVersion?.refundRule)
        : undefined,
    });
    if (res.ok && res.data?.success) {
      showToast('New draft version created');
      await loadDetail(selectedPolicy._id);
      setActiveTab('draft');
    } else {
      setError(res.data?.message || 'Unable to create draft version.');
    }
    setSaving(false);
  };

  const handlePublish = async () => {
    if (!selectedPolicy || !activeDraft) return;
    const ruleErrors = selectedPolicy.controlsBookingRefunds
      ? validateRefundRule(draft?.refundRule)
      : {};
    setDraftRuleErrors(ruleErrors);
    if (Object.keys(ruleErrors).length > 0) {
      setError('Please fix the refund rule errors before publishing this draft.');
      return;
    }

    const message = selectedPolicy.controlsBookingRefunds
      ? 'Publish this draft? The policy text and executable refund rules will become immutable together and will apply to newly paid bookings.'
      : 'Publish this draft? Published versions cannot be edited later.';
    
    setConfirmModalState({
      isOpen: true,
      title: 'Publish Policy',
      message,
      isDestructive: false,
      action: async () => {
        setSaving(true);
        setError('');
        const res = await publishPolicyVersion(selectedPolicy._id, activeDraft._id);
        if (res.ok && res.data?.success) {
          showToast('Policy version published');
          await fetchPolicies();
          await loadDetail(selectedPolicy._id);
          setActiveTab('versions');
        } else {
          setError(res.data?.message || 'Unable to publish policy.');
        }
        setSaving(false);
      }
    });
  };


  const handleDelete = async () => {
    if (!selectedPolicy) return;
    setConfirmModalState({
      isOpen: true,
      title: 'Delete Policy',
      message: 'Permanently delete this policy, all versions, refund rules, and customer acceptance records? This action cannot be undone.',
      isDestructive: true,
      action: async () => {
        setSaving(true);
        setError('');
        const res = await deletePolicy(selectedPolicy._id);
        if (res.ok && res.data?.success) {
          showToast('Policy deleted');
          setSelectedId('');
          setDetail(null);
          setAcceptances([]);
          setAcceptanceMeta(null);
          await fetchPolicies();
        } else {
          setError(res.data?.message || 'Unable to delete policy.');
        }
        setSaving(false);
      }
    });
  };

  const summary = useMemo(() => {
    const total = policies.length;
    const published = policies.filter((policy) => policy.status === 'published').length;
    const drafts = policies.filter((policy) => policy.status === 'draft').length;
    const archived = policies.filter((policy) => policy.status === 'archived').length;
    return [
      { label: 'Total Policies', value: total, note: 'All records', icon: FileText },
      { label: 'Published', value: published, note: 'Active policies', icon: CheckCircle2 },
      { label: 'Drafts', value: drafts, note: 'In progress', icon: Clock3 },
      { label: 'Archived', value: archived, note: 'Retained history', icon: Archive },
    ];
  }, [policies]);

  const visiblePolicies = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...policies]
      .filter((policy) => {
        const matchesStatus = statusFilter === 'all' || policy.status === statusFilter;
        const haystack = [
          policy.title,
          policy.slug,
          policy.category,
          policy.status,
          policy.currentVersionNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return matchesStatus && (!query || haystack.includes(query));
      })
      .sort((a, b) => {
        if (sortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
        if (sortMode === 'version') return Number(b.currentVersionNumber || 0) - Number(a.currentVersionNumber || 0);
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
  }, [policies, searchQuery, sortMode, statusFilter]);

  const openCreate = () => {
    setSelectedId('');
    setDetail(null);
    setIsCreating(true);
    setActiveTab('draft');
  };

  const selectPolicy = (policyId) => {
    setIsCreating(false);
    setSelectedId(policyId);
    setActiveTab('overview');
  };

  return (
    <div className={`relative min-h-[calc(100vh-70px)] overflow-auto bg-[#090909] px-4 py-6 text-white sm:px-6 lg:px-8 ${scrollbarClass}`}>
      <div className="pointer-events-none absolute left-8 top-0 h-72 w-72 rounded-full bg-yellow-400/10 blur-[110px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed right-5 top-5 z-50 rounded-[14px] border border-emerald-500/20 bg-emerald-500/95 px-5 py-3 text-sm font-black text-white shadow-2xl"
        >
          {toast}
        </motion.div>
      )}

      <div className="relative mx-auto max-w-[1480px]">
        <motion.header
          {...motionProps}
          className="mb-7 flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-7 lg:flex-row lg:items-end"
        >
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-yellow-300">
              <FileText size={13} />
              Policy Manager
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Policies
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-[15px]">
                 Manage policy drafts, versions, and acceptance records.
            </p>
          </div>
          <PremiumButton onClick={openCreate} className="w-full sm:w-auto">
            <Plus size={17} className="transition-transform group-hover:rotate-90" />
            Create New Policy
          </PremiumButton>
        </motion.header>

        <motion.section
          {...motionProps}
          transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.08 }}
          className="mb-6 grid border-y border-white/[0.08] md:grid-cols-4"
        >
          {summary.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ delay: index * 0.055 }}
                className="group flex items-center gap-4 border-white/[0.08] px-2 py-5 transition hover:bg-white/[0.025] md:px-6 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-yellow-400/15 bg-yellow-400/10 text-yellow-300 transition group-hover:border-yellow-300/30 group-hover:bg-yellow-400/15">
                  <Icon size={17} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {item.label}
                  </p>
                  <div className="mt-1 flex items-end gap-2">
                    <span className="text-2xl font-black leading-none text-white">{item.value}</span>
                    <span className="text-xs font-semibold text-slate-500">{item.note}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.section>

        <motion.section
          {...motionProps}
          transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.12 }}
          className="mb-6 flex flex-col gap-3 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-center"
        >
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-12 w-full rounded-[14px] border border-white/[0.08] bg-[#111111]/80 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-400/45 focus:bg-black/60"
              placeholder="Search policies by name, slug or category..."
            />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <AdminSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={policyStatusOptions}
              icon={SlidersHorizontal}
              className="w-full sm:w-44"
              ariaLabel="Filter policies by status"
            />
            <AdminSelect
              value={sortMode}
              onChange={setSortMode}
              options={policySortOptions}
              icon={Clock3}
              className="w-full sm:w-44"
              align="right"
              ariaLabel="Sort policies"
            />
          </div>
        </motion.section>

        {error && (
          <div className="mb-5 rounded-[14px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
            {error}
          </div>
        )}

        <motion.main
          {...motionProps}
          transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.16 }}
          className="grid min-h-[620px] overflow-hidden border border-white/[0.08] bg-[#0c0c0c]/70 lg:grid-cols-[34%_66%]"
        >
          <aside className="flex min-h-[520px] flex-col border-b border-white/[0.08] lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Policies</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {visiblePolicies.length} of {policies.length} policies
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-slate-300 transition hover:border-yellow-400/40 hover:bg-yellow-400/10 hover:text-yellow-300"
                title="Create policy"
              >
                <Plus size={16} className="transition-transform group-hover:rotate-90" />
              </button>
            </div>
            <div className={`flex-1 overflow-y-auto ${scrollbarClass}`}>
              {loading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-slate-400">
                  <Loader2 size={16} className="animate-spin text-yellow-400" />
                  Loading policies
                </div>
              ) : visiblePolicies.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <FileText size={30} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-sm font-bold text-slate-400">No policies match this view.</p>
                </div>
              ) : (
                <div>
                  {visiblePolicies.map((policy, index) => {
                    const selected = selectedId === policy._id && !isCreating;
                    return (
                      <motion.button
                        key={policy._id}
                        type="button"
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index * 0.025, 0.25) }}
                        onClick={() => selectPolicy(policy._id)}
                        className={`group relative flex w-full items-center gap-4 border-b border-white/[0.06] px-5 py-4 text-left transition ${
                          selected
                            ? 'bg-yellow-400/[0.075]'
                            : 'hover:bg-white/[0.035]'
                        }`}
                      >
                        <span className={`absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full bg-yellow-400 transition-all ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-black text-white">{policy.title}</p>
                            <StatusBadge status={policy.status} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
                            <span className="truncate">/{policy.slug}</span>
                            <span className="h-1 w-1 rounded-full bg-slate-700" />
                            <span>v{policy.currentVersionNumber || 0}</span>
                          </div>
                        </div>
                        <ChevronRight size={16} className="shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-yellow-300" />
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="relative min-h-[620px] overflow-hidden">
            {isCreating ? (
              <CreatePolicyWorkspace
                createForm={createForm}
                setCreateForm={setCreateForm}
                handleCreate={handleCreate}
                saving={saving}
                createRuleErrors={createRuleErrors}
                setCreateRuleErrors={setCreateRuleErrors}
                setError={setError}
              />
            ) : !selectedPolicy ? (
              <EmptyWorkspace onCreate={openCreate} />
            ) : detailLoading ? (
              <div className="flex min-h-[620px] items-center justify-center gap-3 text-sm font-bold text-slate-400">
                <Loader2 size={18} className="animate-spin text-yellow-400" />
                Loading policy detail
              </div>
            ) : (
              <PolicyWorkspace
                selectedPolicy={selectedPolicy}
                versions={versions}
                activeDraft={activeDraft}
                metadata={metadata}
                setMetadata={setMetadata}
                draft={draft}
                setDraft={setDraft}
                saving={saving}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                handleDelete={handleDelete}
                handleMetadataSave={handleMetadataSave}
                handleDraftSave={handleDraftSave}
                handleCreateNextDraft={handleCreateNextDraft}
                handlePublish={handlePublish}
                draftRuleErrors={draftRuleErrors}
                setDraftRuleErrors={setDraftRuleErrors}
                setError={setError}
                acceptances={acceptances}
                acceptanceMeta={acceptanceMeta}
                acceptancesLoading={acceptancesLoading}
                acceptancesError={acceptancesError}
              />
            )}
          </section>
        </motion.main>
      </div>

      <ConfirmModal
        isOpen={confirmModalState.isOpen}
        onClose={() => setConfirmModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={() => confirmModalState.action?.()}
        title={confirmModalState.title}
        message={confirmModalState.message}
        confirmText="Confirm"
        cancelText="Cancel"
        isDestructive={confirmModalState.isDestructive}
      />
    </div>
  );
}

function EmptyWorkspace({ onCreate }) {
  return (
    <div className="relative flex min-h-[620px] items-center justify-center overflow-hidden px-6 text-center">
      <div className="absolute h-80 w-80 rounded-full bg-yellow-400/10 blur-[100px]" />
      <div className="absolute h-[360px] w-[360px] opacity-25 [background-image:radial-gradient(rgba(250,204,21,.38)_1px,transparent_1px)] [background-size:13px_13px]" />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative max-w-md"
      >
        <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-[22px] border border-yellow-400/25 bg-black/45 text-yellow-300 shadow-[0_0_50px_rgba(234,179,8,0.16)]">
          <FileText size={38} strokeWidth={1.4} />
        </div>
        <h2 className="text-2xl font-black text-white">No Policy Selected</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Select a policy from the navigator to view metadata, drafts, versions, and acceptance records.
        </p>
        <PremiumButton onClick={onCreate} className="mt-7">
          <Plus size={16} />
          Create New Policy
        </PremiumButton>
      </motion.div>
    </div>
  );
}

function CreatePolicyWorkspace({
  createForm,
  setCreateForm,
  handleCreate,
  saving,
  createRuleErrors,
  setCreateRuleErrors,
  setError,
}) {
  return (
    <div className={`h-full overflow-y-auto p-5 lg:p-8 ${scrollbarClass}`}>
      <div className="mb-8 border-b border-white/[0.08] pb-6">
        <SectionLabel>Draft Builder</SectionLabel>
        <h2 className="mt-2 text-3xl font-black text-white">Create New Policy</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Start with editable metadata and an initial draft version.
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-6">
        <div className="grid gap-5 xl:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Title</span>
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder="e.g. Terms of Service"
              required
            />
          </label>
          <label className="block">
            <span className={labelClass}>Slug Optional</span>
            <input
              value={createForm.slug}
              onChange={(event) => setCreateForm((current) => ({ ...current, slug: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder="e.g. terms-of-service"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Category</span>
            <AdminSelect
              value={createForm.category}
              onChange={(nextCategory) =>
                setCreateForm((current) => ({
                  ...current,
                  category: nextCategory,
                  controlsBookingRefunds:
                    nextCategory === 'refund'
                      ? current.controlsBookingRefunds
                      : false,
                  refundRule:
                    nextCategory === 'refund' ? current.refundRule : null,
                }))
              }
              options={categoryOptions}
              icon={FileText}
              className="w-full"
              ariaLabel="Select policy category"
            />
          </label>
          <div className="flex items-end">
            <label className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-[14px] border border-white/[0.08] bg-black/45 px-4 text-sm font-bold text-slate-300 transition hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={createForm.requiresAcceptance}
                onChange={(event) => setCreateForm((current) => ({ ...current, requiresAcceptance: event.target.checked }))}
                className="h-4 w-4 accent-yellow-400"
              />
              Requires customer acceptance
            </label>
          </div>
        </div>

        {createForm.category === 'refund' && (
          <label className="flex cursor-pointer items-start gap-3 border-y border-yellow-400/20 bg-yellow-400/[0.04] px-1 py-4 text-sm font-bold text-gray-200 transition hover:bg-yellow-400/[0.07]">
            <input
              type="checkbox"
              checked={createForm.controlsBookingRefunds}
              onChange={(event) => {
                setCreateForm((current) => ({
                  ...current,
                  controlsBookingRefunds: event.target.checked,
                  refundRule: event.target.checked
                    ? normalizeRefundRule(current.refundRule || createDefaultRefundRule())
                    : null,
                }));
                setCreateRuleErrors({});
                setError('');
              }}
              className="mt-0.5 h-4 w-4 accent-yellow-400"
            />
            <span>
              Control booking refunds
              <span className="mt-1 block text-xs font-normal leading-relaxed text-slate-400">
                Designate this refund policy as the executable rule source. Only one policy can be designated.
              </span>
            </span>
          </label>
        )}

        <label className="block">
          <span className={labelClass}>Initial Content</span>
          <textarea
            value={createForm.content}
            onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))}
            className={`${inputClass} min-h-52 rounded-[14px] leading-7`}
            placeholder="Write your policy content here..."
            required
          />
        </label>

        {createForm.controlsBookingRefunds && (
          <div className="border-t border-white/[0.08] pt-6">
            <SectionLabel>Refund Rules Configuration</SectionLabel>
            <div className="mt-4">
              <RefundRuleEditor
                value={createForm.refundRule}
                onChange={(refundRule) => {
                  setCreateForm((current) => ({ ...current, refundRule }));
                  setCreateRuleErrors(validateRefundRule(refundRule));
                  setError('');
                }}
                errors={createRuleErrors}
              />
            </div>
          </div>
        )}

        <PremiumButton type="submit" disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Create Policy
        </PremiumButton>
      </form>
    </div>
  );
}

function PolicyWorkspace({
  selectedPolicy,
  versions,
  activeDraft,
  metadata,
  setMetadata,
  draft,
  setDraft,
  saving,
  activeTab,
  setActiveTab,
  handleDelete,
  handleMetadataSave,
  handleDraftSave,
  handleCreateNextDraft,
  handlePublish,
  draftRuleErrors,
  setDraftRuleErrors,
  setError,
  acceptances,
  acceptanceMeta,
  acceptancesLoading,
  acceptancesError,
}) {
  return (
    <div className="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#0c0c0c]/95 px-5 py-5 backdrop-blur-xl lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="truncate text-2xl font-black text-white lg:text-3xl">
                {selectedPolicy.title}
              </h2>
              <StatusBadge status={selectedPolicy.status} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              /{selectedPolicy.slug} · v{selectedPolicy.currentVersionNumber || 0} · Updated {formatDate(selectedPolicy.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!activeDraft && (
              <PremiumButton variant="ghost" onClick={handleCreateNextDraft} disabled={saving}>
                <Plus size={15} />
                New Draft
              </PremiumButton>
            )}
            {activeDraft && (
              <PremiumButton onClick={handlePublish} disabled={saving}>
                <Send size={15} />
                Publish
              </PremiumButton>
            )}
            <PremiumButton variant="danger" onClick={handleDelete} disabled={saving}>
              <Trash2 size={15} />
              Delete
            </PremiumButton>
          </div>
        </div>

        <nav className="mt-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-white/[0.08]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-black transition ${
                  selected ? 'text-yellow-300' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <Icon size={15} />
                {tab.label}
                {selected && (
                  <motion.span
                    layoutId="policy-tab-underline"
                    className="absolute bottom-[-1px] left-3 right-3 h-[2px] rounded-full bg-yellow-400"
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-5 lg:p-8">
        {activeTab === 'overview' && (
          <OverviewPanel
            selectedPolicy={selectedPolicy}
            metadata={metadata}
            handleMetadataSave={handleMetadataSave}
            setMetadata={setMetadata}
            saving={saving}
          />
        )}
        {activeTab === 'draft' && (
          <DraftPanel
            selectedPolicy={selectedPolicy}
            activeDraft={activeDraft}
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            handleCreateNextDraft={handleCreateNextDraft}
            handleDraftSave={handleDraftSave}
            handlePublish={handlePublish}
            draftRuleErrors={draftRuleErrors}
            setDraftRuleErrors={setDraftRuleErrors}
            setError={setError}
          />
        )}
        {activeTab === 'versions' && (
          <VersionTimeline versions={versions} currentVersionNumber={selectedPolicy.currentVersionNumber} />
        )}
        {activeTab === 'acceptances' && (
          <AcceptancePanel
            acceptances={acceptances}
            acceptanceMeta={acceptanceMeta}
            loading={acceptancesLoading}
            error={acceptancesError}
          />
        )}
      </div>
    </div>
  );
}

function OverviewPanel({ selectedPolicy, metadata, setMetadata, handleMetadataSave, saving }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl">
      <div className="mb-7">
        <SectionLabel>Overview</SectionLabel>
        <h3 className="mt-2 text-2xl font-black text-white">Policy Information</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Metadata stays editable while version content is controlled through drafts.
        </p>
      </div>

      <div className="border-y border-white/[0.08]">
        <InfoLine label="Policy Name" value={selectedPolicy.title} />
        <InfoLine label="Slug" value={`/${selectedPolicy.slug}`} />
        <InfoLine label="Category" value={categoryLabel(selectedPolicy.category)} />
        <InfoLine label="Latest Version" value={`v${selectedPolicy.currentVersionNumber || 0}`} />
        <InfoLine label="Status">
          <StatusBadge status={selectedPolicy.status} />
        </InfoLine>
        <InfoLine label="Requires Acceptance" value={selectedPolicy.requiresAcceptance ? 'Yes' : 'No'} />
        <InfoLine label="Controls Refunds" value={selectedPolicy.controlsBookingRefunds ? 'Yes' : 'No'} />
        <InfoLine label="Created" value={formatDateTime(selectedPolicy.createdAt)} />
        <InfoLine label="Updated" value={formatDateTime(selectedPolicy.updatedAt)} />
      </div>

      {metadata && (
        <div className="mt-8 border-t border-white/[0.08] pt-7">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <SectionLabel>Editable Metadata</SectionLabel>
              <p className="mt-2 text-sm text-slate-400">These fields use the existing save metadata handler.</p>
            </div>
            <PremiumButton variant="light" onClick={handleMetadataSave} disabled={saving}>
              <Save size={16} />
              Save Metadata
            </PremiumButton>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <label>
              <span className={labelClass}>Title</span>
              <input
                value={metadata.title}
                onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
            <label>
              <span className={labelClass}>Slug</span>
              <input
                value={metadata.slug}
                onChange={(event) => setMetadata((current) => ({ ...current, slug: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
            <label>
              <span className={labelClass}>Category</span>
              <AdminSelect
                value={metadata.category}
                onChange={(nextCategory) =>
                  setMetadata((current) => ({
                    ...current,
                    category: nextCategory,
                    controlsBookingRefunds:
                      nextCategory === 'refund'
                        ? current.controlsBookingRefunds
                        : false,
                  }))
                }
                options={categoryOptions}
                icon={FileText}
                className="w-full"
                ariaLabel="Select policy category"
              />
            </label>
            <label className="flex min-h-[48px] cursor-pointer items-center gap-3 self-end rounded-[14px] border border-white/[0.08] bg-black/45 px-4 text-sm font-bold text-slate-300 transition hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={metadata.requiresAcceptance}
                onChange={(event) => setMetadata((current) => ({ ...current, requiresAcceptance: event.target.checked }))}
                className="h-4 w-4 accent-yellow-400"
              />
              Requires customer acceptance
            </label>
            {metadata.category === 'refund' && (
              <label className="flex cursor-pointer items-start gap-3 border-y border-yellow-400/20 bg-yellow-400/[0.04] px-1 py-4 text-sm font-bold text-gray-200 xl:col-span-2">
                <input
                  type="checkbox"
                  checked={metadata.controlsBookingRefunds}
                  onChange={(event) =>
                    setMetadata((current) => ({
                      ...current,
                      controlsBookingRefunds: event.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 accent-yellow-400"
                />
                <span>
                  Control booking refunds
                  <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                    The designated policy publishes legal text and executable refund rules as one immutable version.
                  </span>
                </span>
              </label>
            )}
            <label className="xl:col-span-2">
              <span className={labelClass}>Description</span>
              <textarea
                value={metadata.description}
                onChange={(event) => setMetadata((current) => ({ ...current, description: event.target.value }))}
                className={`${inputClass} min-h-24 rounded-[14px] leading-6`}
              />
            </label>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function DraftPanel({
  selectedPolicy,
  activeDraft,
  draft,
  setDraft,
  saving,
  handleCreateNextDraft,
  handleDraftSave,
  handlePublish,
  draftRuleErrors,
  setDraftRuleErrors,
  setError,
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl">
      <div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <SectionLabel>Draft Editor</SectionLabel>
          <h3 className="mt-2 text-2xl font-black text-white">Editable Draft</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {selectedPolicy.controlsBookingRefunds
              ? 'Policy text and executable refund rules stay editable in draft, then become immutable together when published.'
              : 'Only draft versions can be edited. Publishing makes content immutable.'}
          </p>
        </div>
        {!activeDraft && (
          <PremiumButton variant="ghost" onClick={handleCreateNextDraft} disabled={saving}>
            <Plus size={16} />
            Create Next Draft
          </PremiumButton>
        )}
      </div>

      {!activeDraft || !draft ? (
        <div className="border-y border-white/[0.08] py-12 text-center">
          <FileText size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm font-bold text-slate-400">No editable draft exists for this policy.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_220px]">
            <label>
              <span className={labelClass}>Version Title</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
                placeholder="Version title"
              />
            </label>
            <label>
              <span className={labelClass}>Effective Date</span>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(event) => setDraft((current) => ({ ...current, effectiveDate: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClass}>Summary</span>
            <textarea
              value={draft.summary}
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
              className={`${inputClass} min-h-24 rounded-[14px] leading-6`}
              placeholder="Summary"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Policy Content</span>
            <textarea
              value={draft.content}
              onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
              className={`${inputClass} min-h-[320px] rounded-[14px] leading-7`}
              placeholder="Policy content"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Change Note</span>
            <input
              value={draft.changeNote}
              onChange={(event) => setDraft((current) => ({ ...current, changeNote: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder="Change note"
            />
          </label>
          {selectedPolicy.controlsBookingRefunds && (
            <div className="border-t border-white/[0.08] pt-6">
              <SectionLabel>Refund Rules</SectionLabel>
              <div className="mt-4 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <RefundRuleEditor
                  value={draft.refundRule}
                  onChange={(refundRule) => {
                    setDraft((current) => ({ ...current, refundRule }));
                    setDraftRuleErrors(validateRefundRule(refundRule));
                    setError('');
                  }}
                  errors={draftRuleErrors}
                />
                <RefundRulePreview
                  rule={draft.refundRule}
                  hasErrors={Object.keys(draftRuleErrors).length > 0}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-6">
            <PremiumButton variant="light" onClick={handleDraftSave} disabled={saving}>
              <Save size={16} />
              Save Draft
            </PremiumButton>
            <PremiumButton onClick={handlePublish} disabled={saving}>
              <Send size={16} />
              {selectedPolicy.controlsBookingRefunds
                ? 'Publish Immutable Text + Rules'
                : 'Publish Immutable Version'}
            </PremiumButton>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function VersionTimeline({ versions, currentVersionNumber }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl">
      <div className="mb-7">
        <SectionLabel>Version History</SectionLabel>
        <h3 className="mt-2 text-2xl font-black text-white">Timeline</h3>
        <p className="mt-2 text-sm text-slate-400">Published versions are immutable. Drafts remain editable until publishing.</p>
      </div>
      <div className="relative border-y border-white/[0.08] py-3">
        {versions.length === 0 ? (
          <p className="py-10 text-center text-sm font-bold text-slate-500">No versions yet.</p>
        ) : (
          versions.map((version, index) => {
            const active = version.versionNumber === currentVersionNumber;
            return (
              <div key={version._id} className="relative grid gap-4 py-5 pl-10 md:grid-cols-[minmax(0,1fr)_160px_120px]">
                {index < versions.length - 1 && (
                  <span className="absolute left-[13px] top-10 h-[calc(100%-18px)] w-px bg-white/[0.08]" />
                )}
                <span className={`absolute left-0 top-6 flex h-7 w-7 items-center justify-center rounded-full border ${
                  active
                    ? 'border-yellow-300 bg-yellow-400 text-black shadow-[0_0_28px_rgba(234,179,8,0.28)]'
                    : 'border-white/[0.1] bg-[#111111] text-slate-500'
                }`}>
                  <span className="h-2 w-2 rounded-full bg-current" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-black text-white">v{version.versionNumber} · {version.title || 'Untitled version'}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{version.summary || version.changeNote || 'No summary provided.'}</p>
                </div>
                <div>
                  <StatusBadge status={version.status} />
                  <p className="mt-2 text-xs font-semibold text-slate-500">{formatDate(version.effectiveDate)}</p>
                </div>
                <div className="inline-flex items-center gap-2 text-sm font-black text-emerald-300">
                  <CheckCircle2 size={15} />
                  {version.acceptanceCount || 0}
                </div>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

function AcceptancePanel({ acceptances, acceptanceMeta, loading, error }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-7 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <SectionLabel>Acceptances</SectionLabel>
          <h3 className="mt-2 text-2xl font-black text-white">Customer Records</h3>
          <p className="mt-2 text-sm text-slate-400">
            Showing the latest {acceptanceMeta?.limit || 50} records from the existing policy acceptance endpoint.
          </p>
        </div>
        {acceptanceMeta && (
          <div className="text-sm font-bold text-slate-500">
            {acceptanceMeta.total || 0} total records
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 border-y border-white/[0.08] py-14 text-sm font-bold text-slate-400">
          <Loader2 size={16} className="animate-spin text-yellow-400" />
          Loading acceptance records
        </div>
      ) : error ? (
        <div className="border-y border-red-500/20 bg-red-500/5 py-8 text-center text-sm font-bold text-red-300">
          {error}
        </div>
      ) : acceptances.length === 0 ? (
        <div className="border-y border-white/[0.08] py-14 text-center">
          <Users size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm font-bold text-slate-400">No acceptance records yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden border-y border-white/[0.08]">
          <div className={`max-h-[520px] overflow-auto ${scrollbarClass}`}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#111111] text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-4">Customer</th>
                  <th className="px-4 py-4">Version</th>
                  <th className="px-4 py-4">Accepted</th>
                  <th className="px-4 py-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {acceptances.map((item) => (
                  <tr key={item._id} className="text-slate-300 transition hover:bg-white/[0.025]">
                    <td className="px-4 py-4">
                      <p className="font-black text-white">{item.userId?.username || item.userId?.email || 'Unknown customer'}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{item.userId?.email || item.userId?._id || '-'}</p>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-300">
                      v{item.policyVersionId?.versionNumber || '-'}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-400">{formatDateTime(item.acceptedAt)}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-black uppercase text-slate-400">
                        {item.source || 'web'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </motion.div>
  );
}
