import AnimatedNumber from '../../components/AnimatedNumber';
import './adminPageConsistency.css';
import './policyList.css';
import AdminBackgroundOverlay from '../../components/Admin/AdminBackgroundOverlay';
import { useEffect, useRef, useMemo, useState } from 'react';
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
import { useLanguage } from '../../i18n/hooks/useLanguage';

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

const categoryLabel = (value, t) =>
  t(`policyUi.categories.${value}`, { defaultValue: categories.find(([key]) => key === value)?.[1] || value || 'Other' });

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

function StatusBadge({ status, t }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${statusClass(status)}`}>
      {t(`policyUi.statusLabels.${status || 'draft'}`, { defaultValue: status || 'draft' })}
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
  const { t } = useLanguage();
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
  const [listPage, setListPage] = useState(1);
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

  const aiRefreshGeneration = useRef(0);
  const fetchPolicies = async () => {
    const generation = ++aiRefreshGeneration.current;
    const res = await getAdminPolicies();
      if (generation !== aiRefreshGeneration.current) return;
    if (res.ok && res.data?.success) {
      setPolicies(res.data.data || []);
    } else {
      setError(res.data?.message || t('policyUi.errors.loadPolicies'));
    }
  };
  const aiLoader = useRef(null);
  useEffect(() => { aiLoader.current = fetchPolicies; });
  useEffect(() => {
    const onChange = ({ detail }) => {
      if (['CREATE_POLICY_DRAFT', 'ARCHIVE_POLICY'].includes(detail?.type)) aiLoader.current?.();
    };
    window.addEventListener('valo:admin-data-changed', onChange);
    return () => { aiRefreshGeneration.current += 1; window.removeEventListener('valo:admin-data-changed', onChange); };
  }, []);


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
      setError(res.data?.message || t('policyUi.errors.loadDetails'));
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
        setAcceptancesError(res.data?.message || t('policyUi.errors.loadAcceptances'));
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
      setError(t('policyUi.errors.createRule'));
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
      showToast(t('policyUi.toasts.created'));
      setCreateForm(emptyCreateForm);
      setIsCreating(false);
      await fetchPolicies();
      setSelectedId(res.data.data._id);
      setActiveTab('draft');
    } else {
      setError(res.data?.message || t('policyUi.errors.create'));
    }
    setSaving(false);
  };

  const handleMetadataSave = async () => {
    if (!selectedPolicy) return;
    setSaving(true);
    setError('');
    const res = await updatePolicy(selectedPolicy._id, metadata);
    if (res.ok && res.data?.success) {
      showToast(t('policyUi.toasts.metadataSaved'));
      await fetchPolicies();
      await loadDetail(selectedPolicy._id);
    } else {
      setError(res.data?.message || t('policyUi.errors.saveMetadata'));
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
      setError(t('policyUi.errors.saveRule'));
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
      showToast(t('policyUi.toasts.draftSaved'));
      await loadDetail(selectedPolicy._id);
    } else {
      setError(res.data?.message || t('policyUi.errors.saveDraft'));
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
      showToast(t('policyUi.toasts.versionCreated'));
      await loadDetail(selectedPolicy._id);
      setActiveTab('draft');
    } else {
      setError(res.data?.message || t('policyUi.errors.createVersion'));
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
      setError(t('policyUi.errors.publishRule'));
      return;
    }

    const message = selectedPolicy.controlsBookingRefunds
      ? t('policyUi.confirm.publishRules')
      : t('policyUi.confirm.publishText');
    
    setConfirmModalState({
      isOpen: true,
      title: t('policyUi.confirm.publishTitle'),
      message,
      isDestructive: false,
      action: async () => {
        setSaving(true);
        setError('');
        const res = await publishPolicyVersion(selectedPolicy._id, activeDraft._id);
        if (res.ok && res.data?.success) {
          showToast(t('policyUi.toasts.published'));
          await fetchPolicies();
          await loadDetail(selectedPolicy._id);
          setActiveTab('versions');
        } else {
          setError(res.data?.message || t('policyUi.errors.publish'));
        }
        setSaving(false);
      }
    });
  };


  const handleDelete = async () => {
    if (!selectedPolicy) return;
    setConfirmModalState({
      isOpen: true,
      title: t('policyUi.confirm.deleteTitle'),
      message: t('policyUi.confirm.deleteMessage'),
      isDestructive: true,
      action: async () => {
        setSaving(true);
        setError('');
        const res = await deletePolicy(selectedPolicy._id);
        if (res.ok && res.data?.success) {
          showToast(t('policyUi.toasts.deleted'));
          setSelectedId('');
          setDetail(null);
          setAcceptances([]);
          setAcceptanceMeta(null);
          await fetchPolicies();
        } else {
          setError(res.data?.message || t('policyUi.errors.delete'));
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
      { label: t('policyUi.summary.total'), value: total, note: t('policyUi.summary.allRecords'), icon: FileText },
      { label: t('policyUi.summary.published'), value: published, note: t('policyUi.summary.active'), icon: CheckCircle2 },
      { label: t('policyUi.summary.drafts'), value: drafts, note: t('policyUi.summary.progress'), icon: Clock3 },
      { label: t('policyUi.summary.archived'), value: archived, note: t('policyUi.summary.history'), icon: Archive },
    ];
  }, [policies, t]);

  const localizedStatusOptions = policyStatusOptions.map(({ value }) => ({ value, label: t(`policyUi.${value === 'all' ? 'allStatus' : value}`) }));
  const localizedSortOptions = policySortOptions.map(({ value }) => ({ value, label: t(`policyUi.sort${value === 'updated' ? 'Updated' : value === 'title' ? 'Title' : 'Version'}`) }));

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

  const listPageSize = 5;
  const listTotalPages = Math.max(1, Math.ceil(visiblePolicies.length / listPageSize));
  const currentListPage = Math.min(listPage, listTotalPages);
  const listStart = (currentListPage - 1) * listPageSize;
  const paginatedPolicies = visiblePolicies.slice(listStart, listStart + listPageSize);
  const firstPageButton = Math.max(1, Math.min(currentListPage - 1, listTotalPages - 2));
  const listPageButtons = Array.from(
    { length: Math.min(3, listTotalPages) },
    (_, index) => firstPageButton + index
  );

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
    <div className={`admin-consistency admin-policy-consistency relative bg-[#090909] px-4 py-6 text-white sm:px-6 lg:px-8 ${scrollbarClass}`}>
      <AdminBackgroundOverlay />

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed right-5 top-5 z-50 rounded-[14px] border border-emerald-500/20 bg-emerald-500/95 px-5 py-3 text-sm font-black text-white shadow-2xl"
        >
          {toast}
        </motion.div>
      )}

      <div className="policy-page-content relative mx-auto max-w-[1480px]">
        <motion.header
          {...motionProps}
          className="c4-header mb-7 flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-7 lg:flex-row lg:items-end"
        >
          <div>
            <div className="c4-title-line"><h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              {t('policyUi.policies')}
            </h1><div className="c4-badge">
              <FileText size={13} />
              {t('policyUi.badge')}
            </div></div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-[15px]">
                 {t('policyUi.subtitle', { defaultValue: 'Manage policy drafts, versions, and acceptance records.' })}
            </p>
          </div>
          <PremiumButton onClick={openCreate} className="w-full sm:w-auto">
            <Plus size={17} className="transition-transform group-hover:rotate-90" />
            {t('policyUi.create')}
          </PremiumButton>
        </motion.header>

        <motion.section
          {...motionProps}
          transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.08 }}
          className="c4-kpis c4-four mb-6 grid border-y border-white/[0.08] md:grid-cols-4"
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
                    <span className="c4-kpi-value admin-type-kpi text-2xl font-black leading-none text-white"><AnimatedNumber value={item.value} /></span>
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
          className="policy-filters mb-3 flex flex-col gap-2 border-b border-white/[0.08] pb-3 lg:flex-row lg:items-center"
        >
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
            <input
              value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); setListPage(1); }}
              className="h-11 w-full rounded-[14px] border border-white/[0.08] bg-[#111111]/80 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-400/45 focus:bg-black/60"
              placeholder={t('policyUi.search')}
            />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <AdminSelect
              value={statusFilter}
              onChange={(value) => { setStatusFilter(value); setListPage(1); }}
              options={localizedStatusOptions}
              icon={SlidersHorizontal}
              className="w-full sm:w-44"
              ariaLabel={t('policyUi.filterStatus')}
            />
            <AdminSelect
              value={sortMode}
              onChange={(value) => { setSortMode(value); setListPage(1); }}
              options={localizedSortOptions}
              icon={Clock3}
              className="w-full sm:w-44"
              align="right"
              ariaLabel={t('policyUi.sortPolicies')}
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
          className="policy-workspace border border-white/[0.08] bg-[#0c0c0c]/70"
        >
          <aside aria-label={t('policyUi.policies')} className="policy-list flex min-w-0 flex-col border-b border-white/[0.08] lg:border-b-0 lg:border-r">
            <div className="policy-list-toolbar flex items-center justify-between border-b border-white/[0.08]">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <h2 className="text-sm font-bold text-white">{t('policyUi.policies')}</h2>
                <p className="text-xs text-slate-500">
                  {t('policyUi.policyCount', { shown: visiblePolicies.length, total: policies.length })}
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-slate-300 transition hover:border-yellow-400/40 hover:bg-yellow-400/10 hover:text-yellow-300"
                title={t('policyUi.actions.createPolicy')}
                aria-label={t('policyUi.actions.createPolicy')}
              >
                <Plus size={16} className="transition-transform group-hover:rotate-90" />
              </button>
            </div>
            <div aria-hidden="true" className="policy-list-columns"><span>{t('policyUi.overview.policyName')}</span><span>{t('policyUi.overview.status')}</span><span /></div>
            <div className="policy-list-body min-w-0" tabIndex={0} role="region" aria-label={t('policyUi.policies')}>
              {loading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-sm font-bold text-slate-400">
                  <Loader2 size={16} className="animate-spin text-yellow-400" />
                  {t('policyUi.loadingPolicies')}
                </div>
              ) : visiblePolicies.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <FileText size={30} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-sm font-bold text-slate-400">{t('policyUi.noMatch')}</p>
                </div>
              ) : (
                <div>
                  {paginatedPolicies.map((policy) => {
                    const selected = selectedId === policy._id && !isCreating;
                    return (
                      <button
                        key={policy._id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectPolicy(policy._id)}
                        className={`policy-list-row group ${selected ? 'is-selected' : ''}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white" title={policy.title}>{policy.title}</span>
                          <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                            <span className="truncate" title={`/${policy.slug}`}>/{policy.slug}</span>
                            <span aria-hidden="true">&middot;</span>
                            <span className="shrink-0">v{policy.currentVersionNumber || 0}</span>
                          </span>
                        </span>
                        <span><StatusBadge status={policy.status} t={t} /></span>
                        <ChevronRight size={14} aria-hidden="true" className="text-slate-600 group-hover:text-[#e8d5ad]" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <footer className="policy-list-pagination">
              <p className="text-xs text-white/40" aria-live="polite">
                {t('policyUi.listRange', { from: visiblePolicies.length ? listStart + 1 : 0, to: Math.min(listStart + listPageSize, visiblePolicies.length), count: visiblePolicies.length })}
              </p>
              <nav aria-label={t('policyUi.policies')} className="flex items-center gap-1">
                <button type="button" disabled={loading || currentListPage === 1} onClick={() => setListPage(currentListPage - 1)} aria-label={t('common.previous', { defaultValue: 'Previous' })}>&larr; {t('common.previous', { defaultValue: 'Prev' })}</button>
                {listPageButtons.map((page) => (
                  <button key={page} type="button" disabled={loading || visiblePolicies.length === 0} aria-label={`Policy page ${page}`} aria-current={page === currentListPage ? 'page' : undefined} onClick={() => setListPage(page)}>{page}</button>
                ))}
                <button type="button" disabled={loading || currentListPage === listTotalPages} onClick={() => setListPage(currentListPage + 1)} aria-label={t('common.next', { defaultValue: 'Next' })}>{t('common.next', { defaultValue: 'Next' })} &rarr;</button>
              </nav>
            </footer>
          </aside>

          <section aria-label="Policy Details" tabIndex={isCreating ? 0 : undefined} className={`policy-detail relative min-w-0 ${isCreating ? 'is-creating' : ''}`}>
            {isCreating ? (
              <CreatePolicyWorkspace
                createForm={createForm}
                setCreateForm={setCreateForm}
                handleCreate={handleCreate}
                saving={saving}
                createRuleErrors={createRuleErrors}
                setCreateRuleErrors={setCreateRuleErrors}
                setError={setError}
                t={t}
              />
            ) : !selectedPolicy ? (
              <EmptyWorkspace onCreate={openCreate} t={t} />
            ) : detailLoading ? (
              <div className="flex min-h-[280px] items-center justify-center gap-3 text-sm font-bold text-slate-400">
                <Loader2 size={18} className="animate-spin text-yellow-400" />
                {t('policyUi.loadingDetail')}
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
                t={t}
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
        confirmText={t('policyUi.actions.confirm')}
        cancelText={t('policyUi.actions.cancel')}
        isDestructive={confirmModalState.isDestructive}
      />
    </div>
  );
}

function EmptyWorkspace({ onCreate, t }) {
  return (
    <div className="policy-empty relative flex min-h-[280px] items-center justify-center overflow-hidden px-5 py-7 text-center">
      <div className="absolute h-[180px] w-[180px] opacity-10 [background-image:radial-gradient(rgba(250,204,21,.38)_1px,transparent_1px)] [background-size:13px_13px]" />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative max-w-md"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] border border-yellow-400/25 bg-black/45 text-yellow-300">
          <FileText size={25} strokeWidth={1.4} />
        </div>
        <h2 className="text-xl font-bold text-white">{t('policyUi.noSelection')}</h2>
        <PremiumButton onClick={onCreate} className="mt-4">
          <Plus size={16} />
          {t('policyUi.create')}
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
  t,
}) {
  return (
    <div className="min-w-0 p-5 lg:p-6">
      <div className="mb-8 border-b border-white/[0.08] pb-6">
        <SectionLabel>{t('policyUi.createWorkspace.badge')}</SectionLabel>
        <h2 className="mt-2 text-3xl font-black text-white">{t('policyUi.createWorkspace.title')}</h2>
      </div>

      <form onSubmit={handleCreate} className="space-y-6">
        <div className="grid gap-5 xl:grid-cols-2">
          <label className="block">
            <span className={labelClass}>{t('policyUi.createWorkspace.titleLabel')}</span>
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder={t('policyUi.createWorkspace.titlePlaceholder')}
              required
            />
          </label>
          <label className="block">
            <span className={labelClass}>{t('policyUi.createWorkspace.slugLabel')}</span>
            <input
              value={createForm.slug}
              onChange={(event) => setCreateForm((current) => ({ ...current, slug: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder={t('policyUi.createWorkspace.slugPlaceholder')}
            />
          </label>
          <label className="block">
            <span className={labelClass}>{t('policyUi.createWorkspace.categoryLabel')}</span>
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
              options={categories.map(([value]) => ({ value, label: t(`policyUi.categories.${value}`) }))}
              icon={FileText}
              className="w-full"
              ariaLabel={t('policyUi.createWorkspace.selectCategory')}
            />
          </label>
          <div className="flex items-end">
            <label className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 text-sm font-bold text-slate-300">
              <input
                type="checkbox"
                checked={createForm.requiresAcceptance}
                onChange={(event) => setCreateForm((current) => ({ ...current, requiresAcceptance: event.target.checked }))}
                className="h-4 w-4 accent-yellow-400"
              />
              {t('policyUi.createWorkspace.requiresAcceptance')}
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
              {t('policyUi.createWorkspace.refundControl')}
              <span className="mt-1 block text-xs font-normal leading-relaxed text-slate-400">
                {t('policyUi.createWorkspace.refundHint')}
              </span>
            </span>
          </label>
        )}

        <label className="block">
          <span className={labelClass}>{t('policyUi.createWorkspace.initialContent')}</span>
          <textarea
            value={createForm.content}
            onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))}
            className={`${inputClass} min-h-52 rounded-[14px] leading-7`}
            placeholder={t('policyUi.createWorkspace.contentPlaceholder')}
            required
          />
        </label>

        {createForm.controlsBookingRefunds && (
          <div className="border-t border-white/[0.08] pt-6">
            <SectionLabel>{t('policyUi.createWorkspace.refundConfig')}</SectionLabel>
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
          {t('policyUi.create')}
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
  t,
}) {
  return (
    <div className="policy-detail-workspace min-w-0">
      <div className="policy-detail-header z-20 border-b border-white/[0.08] bg-[#0c0c0c]/95 px-5 py-5 backdrop-blur-xl lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="truncate text-2xl font-black text-white lg:text-3xl">
                {selectedPolicy.title}
              </h2>
              <StatusBadge status={selectedPolicy.status} t={t} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              /{selectedPolicy.slug} · v{selectedPolicy.currentVersionNumber || 0} · {t('policyUi.overview.updated')} {formatDate(selectedPolicy.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeTab === 'overview' && metadata && (
              <PremiumButton variant="light" onClick={handleMetadataSave} disabled={saving}>
                <Save size={16} />
                {t('policyUi.actions.saveMetadata')}
              </PremiumButton>
            )}
            {!activeDraft && (
              <PremiumButton variant="ghost" onClick={handleCreateNextDraft} disabled={saving}>
                <Plus size={15} />
                {t('policyUi.actions.newDraft')}
              </PremiumButton>
            )}
            {activeDraft && (
              <PremiumButton onClick={handlePublish} disabled={saving}>
                <Send size={15} />
                {t('policyUi.actions.publish')}
              </PremiumButton>
            )}
            <PremiumButton variant="danger" onClick={handleDelete} disabled={saving}>
              <Trash2 size={15} />
              {t('policyUi.actions.delete')}
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
                {t(`policyUi.tabs.${tab.id}`)}
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

      <div className="policy-tab-content p-5 lg:p-8" tabIndex={0} role="region" aria-label={`${t(`policyUi.tabs.${activeTab}`)} content`}>
        {activeTab === 'overview' && (
          <OverviewPanel
            selectedPolicy={selectedPolicy}
            metadata={metadata}
            setMetadata={setMetadata}
            t={t}
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
            t={t}
          />
        )}
        {activeTab === 'versions' && (
          <VersionTimeline versions={versions} currentVersionNumber={selectedPolicy.currentVersionNumber} t={t} />
        )}
        {activeTab === 'acceptances' && (
          <AcceptancePanel
            acceptances={acceptances}
            acceptanceMeta={acceptanceMeta}
            loading={acceptancesLoading}
            error={acceptancesError}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

function OverviewPanel({ selectedPolicy, metadata, setMetadata, t }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="policy-overview max-w-4xl">
      <div className="mb-7">
        <h3 className="mt-2 text-2xl font-black text-white">{t('policyUi.overview.information')}</h3>
      </div>

      <div className="policy-info-grid border-y border-white/[0.08]">
        <InfoLine label={t('policyUi.overview.policyName')} value={selectedPolicy.title} />
        <InfoLine label={t('policyUi.overview.slug')} value={`/${selectedPolicy.slug}`} />
        <InfoLine label={t('policyUi.overview.category')} value={categoryLabel(selectedPolicy.category, t)} />
        <InfoLine label={t('policyUi.overview.latestVersion')} value={`v${selectedPolicy.currentVersionNumber || 0}`} />
        <InfoLine label={t('policyUi.overview.status')}>
          <StatusBadge status={selectedPolicy.status} t={t} />
        </InfoLine>
        <InfoLine label={t('policyUi.overview.requiresAcceptance')} value={selectedPolicy.requiresAcceptance ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
        <InfoLine label={t('policyUi.overview.controlsRefunds')} value={selectedPolicy.controlsBookingRefunds ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })} />
        <InfoLine label={t('policyUi.overview.created')} value={formatDateTime(selectedPolicy.createdAt)} />
        <InfoLine label={t('policyUi.overview.updated')} value={formatDateTime(selectedPolicy.updatedAt)} />
      </div>

      {metadata && (
        <div className="policy-metadata mt-8 border-t border-white/[0.08] pt-7">
          <div className="policy-metadata-heading mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <SectionLabel>{t('policyUi.overview.editable')}</SectionLabel>
              <p className="mt-2 text-sm text-slate-400">{t('policyUi.overview.editableHint')}</p>
            </div>

          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <label>
              <span className={labelClass}>{t('policyUi.overview.title')}</span>
              <input
                value={metadata.title}
                onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
            <label>
              <span className={labelClass}>{t('policyUi.overview.slug')}</span>
              <input
                value={metadata.slug}
                onChange={(event) => setMetadata((current) => ({ ...current, slug: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
            <label>
              <span className={labelClass}>{t('policyUi.overview.category')}</span>
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
                options={categories.map(([value]) => ({ value, label: t(`policyUi.categories.${value}`) }))}
                icon={FileText}
                className="w-full"
                ariaLabel={t('policyUi.createWorkspace.selectCategory')}
              />
            </label>
            <label className="flex min-h-[48px] cursor-pointer items-center gap-3 self-end text-sm font-bold text-slate-300">
              <input
                type="checkbox"
                checked={metadata.requiresAcceptance}
                onChange={(event) => setMetadata((current) => ({ ...current, requiresAcceptance: event.target.checked }))}
                className="h-4 w-4 accent-yellow-400"
              />
              {t('policyUi.createWorkspace.requiresAcceptance')}
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
                  {t('policyUi.createWorkspace.refundControl')}
                  <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                    {t('policyUi.createWorkspace.refundHint')}
                  </span>
                </span>
              </label>
            )}
            <label className="xl:col-span-2">
              <span className={labelClass}>{t('policyUi.overview.description')}</span>
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
  t,
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl">
      <div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <SectionLabel>{t('policyUi.draftPanel.editor')}</SectionLabel>
          <h3 className="mt-2 text-2xl font-black text-white">{t('policyUi.draftPanel.editableDraft')}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            {selectedPolicy.controlsBookingRefunds
              ? t('policyUi.draftPanel.refundHint', { defaultValue: 'Policy text and executable refund rules stay editable in draft, then become immutable together when published.' })
              : t('policyUi.draftPanel.hint')}
          </p>
        </div>
        {!activeDraft && (
          <PremiumButton variant="ghost" onClick={handleCreateNextDraft} disabled={saving}>
            <Plus size={16} />
            {t('policyUi.actions.newDraft')}
          </PremiumButton>
        )}
      </div>

      {!activeDraft || !draft ? (
        <div className="border-y border-white/[0.08] py-12 text-center">
          <FileText size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm font-bold text-slate-400">{t('policyUi.draftPanel.noDraft')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_220px]">
            <label>
              <span className={labelClass}>{t('policyUi.draftPanel.versionTitle')}</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
                placeholder={t('policyUi.draftPanel.versionTitle')}
              />
            </label>
            <label>
              <span className={labelClass}>{t('policyUi.draftPanel.effectiveDate')}</span>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(event) => setDraft((current) => ({ ...current, effectiveDate: event.target.value }))}
                className={`${inputClass} rounded-[14px]`}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClass}>{t('policyUi.draftPanel.summary')}</span>
            <textarea
              value={draft.summary}
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
              className={`${inputClass} min-h-24 rounded-[14px] leading-6`}
              placeholder={t('policyUi.draftPanel.summary')}
            />
          </label>
          <label className="block">
            <span className={labelClass}>{t('policyUi.draftPanel.content')}</span>
            <textarea
              value={draft.content}
              onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
              className={`${inputClass} min-h-[320px] rounded-[14px] leading-7`}
              placeholder={t('policyUi.createWorkspace.contentPlaceholder')}
            />
          </label>
          <label className="block">
            <span className={labelClass}>{t('policyUi.draftPanel.changeNote')}</span>
            <input
              value={draft.changeNote}
              onChange={(event) => setDraft((current) => ({ ...current, changeNote: event.target.value }))}
              className={`${inputClass} rounded-[14px]`}
              placeholder={t('policyUi.draftPanel.changeNotePlaceholder')}
            />
          </label>
          {selectedPolicy.controlsBookingRefunds && (
            <div className="border-t border-white/[0.08] pt-6">
              <SectionLabel>{t('policyUi.refund.rules')}</SectionLabel>
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
              {t('policyUi.actions.saveDraft')}
            </PremiumButton>
            <PremiumButton onClick={handlePublish} disabled={saving}>
              <Send size={16} />
              {selectedPolicy.controlsBookingRefunds
                ? t('policyUi.actions.publishImmutable')
                : t('policyUi.actions.publishImmutable', { defaultValue: 'Publish Immutable Version' })}
            </PremiumButton>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function VersionTimeline({ versions, currentVersionNumber, t }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="policy-overview max-w-4xl">
      <div className="mb-7">
        <SectionLabel>{t('policyUi.versionsPanel.history')}</SectionLabel>
        <h3 className="mt-2 text-2xl font-black text-white">{t('policyUi.versionsPanel.timeline')}</h3>
        <p className="mt-2 text-sm text-slate-400">{t('policyUi.versionsPanel.hint')}</p>
      </div>
      <div className="relative border-y border-white/[0.08] py-3">
        {versions.length === 0 ? (
          <p className="py-10 text-center text-sm font-bold text-slate-500">{t('policyUi.versionsPanel.empty')}</p>
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
                  <p className="text-base font-black text-white">v{version.versionNumber} · {version.title || t('policyUi.versionsPanel.untitled')}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{version.summary || version.changeNote || t('policyUi.versionsPanel.noSummary')}</p>
                </div>
                <div>
                  <StatusBadge status={version.status} t={t} />
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

function AcceptancePanel({ acceptances, acceptanceMeta, loading, error, t }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-7 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <SectionLabel>{t('policyUi.acceptancesPanel.acceptances')}</SectionLabel>
          <h3 className="mt-2 text-2xl font-black text-white">{t('policyUi.acceptancesPanel.records')}</h3>
          <p className="mt-2 text-sm text-slate-400">
            {t('policyUi.acceptancesPanel.hint')}
          </p>
        </div>
        {acceptanceMeta && (
          <div className="text-sm font-bold text-slate-500">
            {acceptanceMeta.total || 0} {t('policyUi.acceptancesPanel.total')}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 border-y border-white/[0.08] py-14 text-sm font-bold text-slate-400">
          <Loader2 size={16} className="animate-spin text-yellow-400" />
          {t('policyUi.acceptancesPanel.loading')}
        </div>
      ) : error ? (
        <div className="border-y border-red-500/20 bg-red-500/5 py-8 text-center text-sm font-bold text-red-300">
          {error}
        </div>
      ) : acceptances.length === 0 ? (
        <div className="border-y border-white/[0.08] py-14 text-center">
          <Users size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm font-bold text-slate-400">{t('policyUi.acceptancesPanel.empty')}</p>
        </div>
      ) : (
        <div className="overflow-hidden border-y border-white/[0.08]">
          <div className={`overflow-x-auto ${scrollbarClass}`}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#111111] text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-4">{t('policyUi.acceptancesPanel.customer')}</th>
                  <th className="px-4 py-4">{t('policyUi.acceptancesPanel.version')}</th>
                  <th className="px-4 py-4">{t('policyUi.acceptancesPanel.accepted')}</th>
                  <th className="px-4 py-4">{t('policyUi.acceptancesPanel.source')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {acceptances.map((item) => (
                  <tr key={item._id} className="text-slate-300 transition hover:bg-white/[0.025]">
                    <td className="px-4 py-4">
                      <p className="font-black text-white">{item.userId?.username || item.userId?.email || t('policyUi.acceptancesPanel.unknown')}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{item.userId?.email || item.userId?._id || '-'}</p>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-300">
                      v{item.policyVersionId?.versionNumber || '-'}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-400">{formatDateTime(item.acceptedAt)}</td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-black uppercase text-slate-400">
                        {item.source || t('policyUi.acceptancesPanel.web')}
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
