import { useEffect, useRef, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ticketPackageLinkState, includeLinkedPackage, highlightTicketPackageRow } from './ticketPackageDeepLink.js';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Crown,
  Diamond,
  Edit2,
  FileText,
  Gift,
  Users,
  Info,
  Package,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import '../Staff/components/staffTicketPackages.css';
import './ticketPackages.css';
import AdminSelect from '../../components/Admin/AdminSelect';
import AdminDateTimePicker from '../../components/Admin/AdminDateTimePicker';
import { apiFetch } from '../../services/api';
import { isSellablePackageType, SELLABLE_PACKAGE_TYPES } from '../../utils/ticketPackageRules';
import ConfirmModal from '../../components/Admin/ConfirmModal';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useTranslation } from 'react-i18next';
import {
  getOperationalValue,
  getOperationalViewState,
} from '../../utils/staffOperationalAvailability';

const localeForLanguage = (language) => (String(language || '').toLowerCase().startsWith('vi') ? 'vi-VN' : 'en-US');

const TYPE_META = {
  hourly: {
    label: 'Hourly',
    Icon: Clock3,
    rowAccent: 'from-cyan-300 to-sky-500',
    badge: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300',
    icon: 'border-cyan-400/15 bg-cyan-400/10 text-cyan-300',
    unit: 'hourly rate',
  },
  daily: {
    label: 'Daily',
    Icon: CalendarClock,
    rowAccent: 'from-sky-300 to-blue-500',
    badge: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
    icon: 'border-sky-400/15 bg-sky-400/10 text-sky-300',
    unit: 'daily rate',
  },
  weekly: {
    label: 'Weekly',
    Icon: CalendarClock,
    rowAccent: 'from-teal-300 to-emerald-500',
    badge: 'border-teal-400/25 bg-teal-400/10 text-teal-300',
    icon: 'border-teal-400/15 bg-teal-400/10 text-teal-300',
    unit: 'weekly rate',
  },
  custom: {
    label: 'Custom',
    Icon: CalendarClock,
    rowAccent: 'from-indigo-300 to-blue-500',
    badge: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-300',
    icon: 'border-indigo-400/15 bg-indigo-400/10 text-indigo-300',
    unit: 'package price',
  },
  monthly: {
    label: 'Monthly',
    Icon: Crown,
    rowAccent: 'from-yellow-300 to-amber-500',
    badge: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-300',
    icon: 'border-yellow-400/15 bg-yellow-400/10 text-yellow-300',
    unit: 'monthly rate',
  },
  yearly: {
    label: 'Yearly',
    Icon: Diamond,
    rowAccent: 'from-purple-300 to-violet-500',
    badge: 'border-purple-400/25 bg-purple-400/10 text-purple-300',
    icon: 'border-purple-400/15 bg-purple-400/10 text-purple-300',
    unit: 'yearly rate',
  },
};

const KNOWN_TYPES = SELLABLE_PACKAGE_TYPES;

const toLocalDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const durationRange = (minutes = 43200) => {
  const start = new Date();
  start.setSeconds(0, 0);
  return { durationStart: toLocalDateTime(start), durationEnd: toLocalDateTime(new Date(start.getTime() + minutes * 60000)) };
};
const rangeMinutes = (start, end) => start && end ? (new Date(end).getTime() - new Date(start).getTime()) / 60000 : NaN;


const formatCurrency = (value = 0, language = 'vi') => `${new Intl.NumberFormat(localeForLanguage(language)).format(Number(value) || 0)} VND`;

const formatPackageDate = (value, fallback = 'Not available', language = 'vi') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const locale = localeForLanguage(language);
  return `${new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}`;
};

const getTypeMeta = (type) => {
  return TYPE_META[type] || {
    label: type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Package',
    Icon: Package,
    rowAccent: 'from-slate-300 to-slate-500',
    badge: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
    icon: 'border-slate-400/15 bg-slate-400/10 text-slate-300',
    unit: 'package rate',
  };
};

const getDefaultBenefitsText = (t) => [
  t('ticketPackageExtras.defaultBenefitSlots'),
  t('ticketPackageExtras.defaultBenefitPriority'),
].join('\n');

function SummaryItem({ icon: Icon, label, value, support, tone = 'text-yellow-300', isAdmin }) {
  if (isAdmin) return (
    <div className="package-kpi">
      <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden="true" />
      <div className="package-kpi-copy">
        <p className="text-xs font-bold text-blue-200/55">{label}</p>
        <div className="package-kpi-line">
          <p className={`package-kpi-value font-mono text-2xl font-black leading-none text-white ${label === 'Last Updated' ? 'package-kpi-date' : ''}`}>{value}</p>
          <span className="package-kpi-support truncate text-xs text-emerald-300" title={support}>{support}</span>
        </div>
      </div>
    </div>
  );
  return (
    <div className="flex min-w-0 items-center gap-4 px-5 py-4 md:border-l md:border-white/10 md:first:border-l-0">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white/[0.03] ${tone}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-1 truncate text-xl font-black text-white">{value}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{support}</p>
      </div>
    </div>
  );
}

function LoadingSkeleton({ isAdmin }) {
  return (
    <div className={`${isAdmin ? 'admin-ticket-packages' : ''} staff-ticket-packages stp-skeleton relative min-h-[calc(100vh-70px)] overflow-hidden bg-[#050505] px-4 py-6 sm:px-6 md:px-8`}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-yellow-400/5 blur-3xl" />
      <div className="mx-auto max-w-7xl animate-pulse motion-reduce:animate-none">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-4 h-7 w-28 rounded-full bg-white/10" />
            <div className="h-10 w-72 rounded bg-white/10" />
            <div className="mt-3 h-4 w-80 max-w-full rounded bg-white/10" />
          </div>
          {isAdmin && <div className="h-12 w-40 rounded-2xl bg-yellow-300/20" />}
        </div>
        <div className="mb-6 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex items-center gap-4 px-5 py-4">
              <div className="h-10 w-10 rounded-xl bg-white/10" />
              <div className="flex-1">
                <div className="h-3 w-24 rounded bg-white/10" />
                <div className="mt-3 h-5 w-20 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
        <div className="mb-5 flex flex-col gap-3 md:flex-row">
          <div className="h-12 flex-1 rounded-xl bg-white/10" />
          <div className="h-12 w-full rounded-xl bg-white/10 md:w-44" />
          <div className="h-12 w-full rounded-xl bg-white/10 md:w-44" />
        </div>
        <div className="stp-rows space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-20 rounded-2xl border border-white/10 bg-white/[0.04]" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PackageRow({ pkg, isAdmin, onEdit, onDelete, onDetails, index, rowRef, t, language }) {
  const meta = getTypeMeta(pkg.type);
  const Icon = meta.Icon;
  const isActive = Boolean(pkg.isActive);
  const typeLabel = t(`adminPages.ticketUi.types.${pkg.type}`, { defaultValue: meta.label });
  const unitLabel = t(`adminPages.ticketUi.units.${pkg.type}`, { defaultValue: meta.unit });
  const packageLabel = pkg.name || t('adminPages.ticketUi.untitled');
  const description = pkg.description || t('adminPages.ticketUi.noDescription');

  if (isAdmin) return (
    <tr ref={rowRef} data-package-type={pkg.type} className="admin-package-row" tabIndex={0} aria-label={t('adminPages.ticketUi.viewDetailsFor', { name: packageLabel })} aria-haspopup="dialog" onClick={() => onDetails(pkg)} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onDetails(pkg);
      }
    }}>
      <td>
        <div className="flex min-w-0 items-center gap-3">
          <Icon size={19} className={`shrink-0 ${meta.icon.split(' ').find((token) => token.startsWith('text-'))}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white" title={pkg.name}>{packageLabel}</p>
            <p className="package-description truncate text-white/40" title={pkg.description}>{description}</p>
            {pkg.type !== 'hourly' && <p className="mt-2 whitespace-normal text-xs text-white/60">
              {t('adminPages.ticketUi.capacityLine', { limit: pkg.stock?.saleLimit ?? pkg.saleLimit ?? t('adminPages.ticketUi.unlimited'), inUse: pkg.stock?.allocatedQuantity ?? '—', holds: pkg.stock?.heldQuantity ?? '—', available: pkg.stock?.remainingQuantity ?? (pkg.saleLimit == null ? t('adminPages.ticketUi.unlimited') : '—')})}
            </p>}
          </div>
        </div>
      </td>
      <td><span className={`inline-flex rounded-full border px-2.5 py-0.5 ${meta.badge}`}>{typeLabel}</span></td>
      <td><p className="font-semibold text-[#e8d5ad]">{formatCurrency(pkg.price, language)}</p><p className="package-description text-white/40">{unitLabel}</p></td>
      <td><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${isActive ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />{isActive ? t('adminPages.ticketUi.active') : t('adminPages.ticketUi.inactive')}</span>{!isActive && <p className="mt-2 text-xs text-white/50">{pkg.inactiveReason === 'SOLD_OUT' ? t('adminPages.ticketUi.soldOut') : t('adminPages.ticketUi.paused')}</p>}</td>
      <td className="text-white/55">{formatPackageDate(pkg.updatedAt || pkg.createdAt, t('adminPages.ticketUi.noTimestamp'), language)}</td>
      <td>
        <div className="flex items-center justify-end gap-2">

          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(pkg); }} aria-label={t('adminPages.ticketUi.editPackage', { name: packageLabel })} title={t('adminPages.ticketUi.editPackage', { name: packageLabel })} className="package-edit inline-flex h-8 w-8 items-center justify-center text-[#e8d5ad]/75 hover:text-[#e8d5ad] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8d5ad]"><Edit2 size={16} /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(pkg._id); }} aria-label={t('adminPages.ticketUi.deletePackage', { name: packageLabel })} title={t('adminPages.ticketUi.deletePackage', { name: packageLabel })} className="inline-flex h-8 w-8 items-center justify-center text-red-400 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <article
      data-package-type={pkg.type} className="stp-row group relative overflow-hidden rounded-2xl border border-white/10 bg-[#111111]/90 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#151515] motion-reduce:transform-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${meta.rowAccent} opacity-70 transition group-hover:opacity-100`} />
      <div className="stp-row-grid grid gap-4 px-4 py-4 md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px_auto] md:items-center md:px-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition group-hover:shadow-lg ${meta.icon}`}>
            <Icon size={19} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-white sm:text-base">{packageLabel}</h3>
            <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-400">{description}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('adminPages.ticketUi.type')}</span>
          <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${meta.badge}`}>
            {typeLabel}
          </span>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('adminPages.ticketUi.price')}</span>
          <div className="text-right md:text-left">
            <p className="font-mono text-sm font-black text-white sm:text-base">{formatCurrency(pkg.price, language)}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{unitLabel}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('adminPages.ticketUi.status')}</span>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${
            isActive
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
              : 'border-slate-400/15 bg-white/5 text-slate-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-300' : 'bg-slate-500'}`} />
            {isActive ? t('adminPages.ticketUi.active') : t('adminPages.ticketUi.inactive')}
          </span>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('adminPages.ticketUi.updated')}</span>
          <p className="text-right text-xs font-semibold text-slate-300 md:text-left">{formatPackageDate(pkg.updatedAt || pkg.createdAt, t('adminPages.ticketUi.noTimestamp'), language)}</p>
        </div>

        {isAdmin && (
          <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 md:border-t-0 md:pt-0">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onEdit(pkg); }}
              aria-label={t('adminPages.ticketUi.editPackage', { name: packageLabel })}
              title={t('adminPages.ticketUi.editPackage', { name: packageLabel })}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/60 motion-reduce:transition-none"
            >
              <Edit2 size={16} className="transition group-hover:scale-105 motion-reduce:transition-none" />
            </button>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onDelete(pkg._id); }}
              aria-label={t('adminPages.ticketUi.deletePackage', { name: packageLabel })}
              title={t('adminPages.ticketUi.deletePackage', { name: packageLabel })}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/10 bg-red-400/5 text-red-300 transition hover:border-red-400/30 hover:bg-red-500/20 hover:text-red-100 focus:outline-none focus:ring-2 focus:ring-red-300/50 motion-reduce:transition-none"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function TicketPackages() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, packageId: null });
  const [editingPackage, setEditingPackage] = useState(null);
  const [activeChanged, setActiveChanged] = useState(false);
  const [detailPackage, setDetailPackage] = useState(null);
  const packageState = getOperationalViewState({ loading, error: loadError });

  const [formData, setFormData] = useState({
    name: '',
    type: 'monthly',
    price: '',
    description: '',
    isActive: true,
    saleLimit: '',
    maxSlots: 3,
    renewalWindowDays: 7,
    isRenewable: true,
    ...durationRange(),
    displayBenefitsText: 'Reserved VIP slots\nPriority parking access',
    serviceBenefits: [],
  });
  const [benefitServices, setBenefitServices] = useState([]);
  const [benefitServicesError, setBenefitServicesError] = useState('');
  const [savingPackage, setSavingPackage] = useState(false);
  const saveInFlight = useRef(false);
  useEffect(() => {
    let active = true;
    apiFetch('/services').then((response) => {
      if (!active) return;
      if (!response.ok || !response.data?.success) throw new Error(t('adminPages.ticketUi.dataUnavailable'));
      setBenefitServices(response.data.data);
    }).catch((error) => { if (active) setBenefitServicesError(error.message); });
    return () => { active = false; };
  }, []);

  let isAdmin = false;
  try {
    const user = JSON.parse(sessionStorage.getItem('valo_user'));
    if (user && user.role === 'admin') isAdmin = true;
  } catch {
    isAdmin = false;
  }

  const packageIdQuery = isAdmin && location.pathname === '/admin/tickets' ? searchParams.get('packageId') : null;
  const packageLinkKey = packageIdQuery ? `${location.key}:${packageIdQuery}` : null;
  const [packageLink, setPackageLink] = useState({ status: 'idle' });
  const linkedRowRef = useRef(null);
  const verifiedPackageId = packageLinkKey && packageLink.key === packageLinkKey && packageLink.status === 'ready' && !loading && !loadError ? packageLink.packageId : null;

  const aiRefreshGeneration = useRef(0);
  const fetchPackages = async () => {
    const generation = ++aiRefreshGeneration.current;
    try {
      setLoading(true);
      setLoadError('');
      if (packageLinkKey) setPackageLink({ key: packageLinkKey, status: 'loading' });
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
        ...(packageLinkKey ? { cache: 'no-store' } : {}),
      });
      const data = await res.json();
      if (Array.isArray(data.data)) data.data = data.data.filter((pkg) => isSellablePackageType(pkg.type));
      if (generation !== aiRefreshGeneration.current) return;
      if (packageLinkKey) setPackageLink({ ...ticketPackageLinkState({ ok: res.ok, status: res.status, data }, packageIdQuery), key: packageLinkKey });
      if (res.ok && data.success && Array.isArray(data.data)) {
        setPackages(data.data);
        setLoadError('');
      } else {
        setPackages([]);
        setLoadError(data?.message || t('adminPages.ticketUi.loadError'));
      }
    } catch (err) {
      if (generation !== aiRefreshGeneration.current) return;
      console.error(err);
      setPackages([]);
      setLoadError(t('adminPages.ticketUi.loadError'));
      if (packageLinkKey) setPackageLink({ key: packageLinkKey, status: 'error' });
    } finally {
      if (generation === aiRefreshGeneration.current) setLoading(false);
    }
  };
  const aiLoader = useRef(null);
  useEffect(() => { aiLoader.current = fetchPackages; });
  useEffect(() => {
    const onChange = ({ detail }) => {
      if (['CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE', 'ARCHIVE_TICKET_PACKAGE'].includes(detail?.type)) aiLoader.current?.();
    };
    window.addEventListener('valo:admin-data-changed', onChange);
    return () => { aiRefreshGeneration.current += 1; window.removeEventListener('valo:admin-data-changed', onChange); };
  }, []);


  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchPackages();
    }, 0);

    return () => { window.clearTimeout(timerId); aiRefreshGeneration.current += 1; };
  }, [packageLinkKey]);

  const openModal = (pkg = null) => {
    setError('');
    setActiveChanged(false);
    if (pkg) {
      setEditingPackage(pkg);
      setFormData({
        name: pkg.name,
        type: pkg.type,
        price: pkg.price,
        description: pkg.description || '',
        isActive: pkg.isActive,
        saleLimit: pkg.saleLimit ?? '',
        maxSlots: pkg.maxSlots ?? 3,
        renewalWindowDays: pkg.renewalWindowDays ?? 7,
        isRenewable: pkg.isRenewable ?? true,
        ...durationRange(pkg.durationMinutes ?? (pkg.durationDays ?? 30) * 1440),
        displayBenefitsText: (pkg.benefitsVersion ? pkg.displayBenefits : getDefaultBenefitsText(t).split('\n')).join('\n'),
        serviceBenefits: (pkg.serviceBenefits || []).map((benefit) => ({ serviceId: benefit.serviceId, quantityPerSlot: benefit.quantityPerSlot })),
      });
    } else {
      setEditingPackage(null);
      setFormData({
        name: '',
        type: 'monthly',
        price: '',
        description: '',
        isActive: true,
        saleLimit: '',
        maxSlots: 3,
        renewalWindowDays: 7,
        isRenewable: true,
        ...durationRange(),
        displayBenefitsText: getDefaultBenefitsText(t),
        serviceBenefits: [],
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saveInFlight.current) return;
    setError('');
    if (formData.type !== 'hourly' && formData.saleLimit !== '' && (!Number.isSafeInteger(Number(formData.saleLimit)) || Number(formData.saleLimit) < 0)) {
      setError(t('adminPages.ticketUi.capacityRenewal'));
      return;
    }
    const durationMinutes = rangeMinutes(formData.durationStart, formData.durationEnd);
    if (formData.type === 'custom' && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 5256000)) {
      setError(t('adminPages.ticketUi.durationInvalid'));
      return;
    }
    if (new Set(formData.serviceBenefits.map((benefit) => benefit.serviceId)).size !== formData.serviceBenefits.length) {
      setError(t('adminPages.ticketUi.includedServices'));
      return;
    }
    saveInFlight.current = true;
    setSavingPackage(true);
    try {
      const payload = {
        ...Object.fromEntries(Object.entries(formData).filter(([key]) => !['durationStart', 'durationEnd', 'displayBenefitsText'].includes(key))),
        price: Number(formData.price),
        saleLimit: formData.type === 'hourly' || formData.saleLimit === '' ? null : Number(formData.saleLimit),
        durationDays: null,
        durationMinutes: formData.type === 'custom' ? durationMinutes : null,
        benefitsVersion: 1,
        displayBenefits: formData.displayBenefitsText.split('\n').map((value) => value.trim()).filter(Boolean),
        serviceBenefits: formData.serviceBenefits.map((benefit) => ({ serviceId: benefit.serviceId, quantityPerSlot: Number(benefit.quantityPerSlot) })),
      };
      // A sold-out package may reopen after a capacity edit. An untouched
      // display toggle must not turn its automatic closure into a manual pause.
      if (editingPackage && !activeChanged) delete payload.isActive;
      if (editingPackage && activeChanged) payload.manualPause = !formData.isActive;
      const config = {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      };

      const url = editingPackage
        ? `${import.meta.env.VITE_API_BASE_URL}/ticket-packages/${editingPackage._id}`
        : `${import.meta.env.VITE_API_BASE_URL}/ticket-packages`;
      const method = editingPackage ? 'PUT' : 'POST';

      const res = await fetch(url, { method, ...config, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        setError(data?.message || t('adminPages.ticketUi.saveError'));
        return; // Keep modal open so admin can see the error
      }

      setShowModal(false);
      fetchPackages();
    } catch (err) {
      console.error(err);
      setError(t('adminPages.ticketUi.networkSaveError'));
    } finally {
      saveInFlight.current = false;
      setSavingPackage(false);
    }
  };

  const handleDelete = (id) => {
    setDeleteModal({ isOpen: true, packageId: id });
  };

  const executeDelete = async () => {
    const { packageId } = deleteModal;
    if (!packageId) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages/${packageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        setError(data?.message || t('adminPages.ticketUi.deleteError'));
        setDeleteModal({ isOpen: false, packageId: null });
        return;
      }

      fetchPackages();
    } catch (err) {
      console.error(err);
      setError(t('adminPages.ticketUi.deleteNetworkError'));
    } finally {
      setDeleteModal({ isOpen: false, packageId: null });
    }
  };

  const summary = useMemo(() => {
    const latest = packages
      .map((pkg) => pkg.updatedAt || pkg.createdAt)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      total: packages.length,
      active: packages.filter((pkg) => pkg.isActive).length,
            latestUpdated: latest ? formatPackageDate(latest, t('adminPages.ticketUi.noTimestamp'), language) : t('adminPages.ticketUi.unavailable'),
    };
  }, [packages, t, language]);

  const typeOptions = useMemo(() => {
    const actualTypes = packages.map((pkg) => pkg.type).filter(isSellablePackageType);
    return Array.from(new Set([...KNOWN_TYPES, ...actualTypes]));
  }, [packages]);

  const filteredPackages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return packages.filter((pkg) => {
      const matchesSearch = !query || [pkg.name, pkg.description, pkg.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesType = typeFilter === 'all' || pkg.type === typeFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && pkg.isActive) ||
        (statusFilter === 'inactive' && !pkg.isActive);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [packages, searchQuery, typeFilter, statusFilter]);
  const visiblePackages = useMemo(() => includeLinkedPackage(filteredPackages, packages, verifiedPackageId), [filteredPackages, packages, verifiedPackageId]);
  useEffect(() => {
    if (!verifiedPackageId) return;
    return highlightTicketPackageRow(linkedRowRef.current);
  }, [verifiedPackageId, packageLinkKey, loading]);

  if (loading && packages.length === 0) {
    return <LoadingSkeleton isAdmin={isAdmin} />;
  }

  return (
    <div className={`${isAdmin ? 'admin-ticket-packages' : ''} staff-ticket-packages relative min-h-[calc(100vh-70px)] overflow-auto bg-[#050505] px-4 py-6 text-white sm:px-6 md:px-8`}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      {!isAdmin && <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-yellow-400/[0.06] blur-3xl" />}
      {!isAdmin && <div className="pointer-events-none absolute right-24 top-16 h-px w-96 max-w-[70vw] bg-gradient-to-r from-transparent via-yellow-300/20 to-transparent" />}

      <div className="stp-content relative mx-auto max-w-7xl">
        {packageLinkKey && packageLink.key === packageLinkKey && !['idle', 'ready'].includes(packageLink.status) && <p role={packageLink.status === 'loading' ? 'status' : 'alert'} className="mb-3 text-sm text-yellow-200">{packageLink.status === 'loading' ? t('adminPages.ticketUi.linkLocating') : packageLink.status === 'missing' ? t('adminPages.ticketUi.linkMissing') : packageLink.status === 'unavailable' ? t('adminPages.ticketUi.linkUnavailable') : t('adminPages.ticketUi.linkFailed')}</p>}
        <header className="stp-header mb-8 flex animate-[fadeIn_420ms_ease-out_both] flex-col justify-between gap-4 motion-reduce:animate-none md:flex-row md:items-end">
          <div>
            {isAdmin ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">{t('adminPages.ticketUi.title')}</h1>
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black text-yellow-300"><Tag size={12} /> {t('adminPages.ticketUi.badge')}</div>
            </div> : <>
            <div className="stp-legacy-label mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <Tag size={12} /> {t('adminPages.ticketUi.badge')}
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">{t('adminPages.ticketUi.title')}</h1>
            </>}
            <p className="mt-2 text-sm font-medium text-slate-400">{t('adminPages.ticketUi.subtitle')}</p>
          </div>

          {!isAdmin && <button type="button" onClick={fetchPackages} disabled={loading} aria-busy={loading} aria-label={t('adminPages.ticketUi.retry')} title={t('adminPages.ticketUi.retry')} className="stp-refresh">
            <RefreshCw size={17} aria-hidden="true" className={loading ? 'animate-spin' : ''} /><span>{t('adminPages.ticketUi.retry')}</span>
          </button>}

          {isAdmin && (
            <button
              type="button"
              onClick={() => openModal()}
              className="admin-package-add group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-500 px-6 text-sm font-black text-[#111111] shadow-lg shadow-yellow-500/20 transition hover:-translate-y-0.5 hover:shadow-yellow-500/30 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-yellow-200/80 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <Plus size={18} className="transition group-hover:rotate-90 motion-reduce:transition-none" />
              {t('adminPages.ticketUi.add')}
            </button>
          )}
        </header>

        {loadError && !showModal && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-200 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle size={18} className="shrink-0" />
              <span className="font-semibold">{loadError}</span>
            </div>
            <button
              type="button"
              onClick={fetchPackages}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300/20 px-3 py-2 text-xs font-black text-red-100 transition hover:bg-red-400/10 focus:outline-none focus:ring-2 focus:ring-red-300/50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {t('adminPages.ticketUi.retry')}
            </button>
          </div>
        )}

        <section className="stp-metrics mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/20 sm:grid-cols-3">
          <SummaryItem
            isAdmin={isAdmin}
            icon={Package}
            label={t('adminPages.ticketUi.total')}
            value={getOperationalValue(packageState, summary.total.toLocaleString(localeForLanguage(language)))}
            support={packageState.isAvailable ? t('adminPages.ticketUi.loaded') : t('adminPages.ticketUi.unavailable')}
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={CheckCircle2}
            label={t('adminPages.ticketUi.activePackages')}
            value={getOperationalValue(packageState, summary.active.toLocaleString(localeForLanguage(language)))}
            support={packageState.isAvailable ? t('adminPages.ticketUi.enabled') : t('adminPages.ticketUi.unavailable')}
            tone="text-emerald-300"
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={CalendarClock}
            label={t('adminPages.ticketUi.updated')}
            value={getOperationalValue(packageState, summary.latestUpdated.split(' ')[0])}
            support={packageState.isAvailable ? (summary.latestUpdated.split(' ').slice(1).join(' ') || t('adminPages.ticketUi.noTimestamp')) : t('adminPages.ticketUi.unavailable')}
            tone="text-blue-300"
          />
        </section>

        <section className="stp-toolbar mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('adminPages.ticketUi.search')}
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-11 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-300/50 focus:ring-2 focus:ring-yellow-300/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('adminPages.ticketUi.clearSearch')}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <AdminSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: t('adminPages.ticketUi.allTypes') },
      ...typeOptions.map((type) => ({ value: type, label: t(`adminPages.ticketUi.types.${type}`, { defaultValue: getTypeMeta(type).label }) })),
            ]}
            icon={Tag}
            className="md:w-44"
            ariaLabel={t('adminPages.ticketUi.filterType')}
          />

          <AdminSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: t('adminPages.ticketUi.allStatus') },
              { value: 'active', label: t('adminPages.ticketUi.active') },
              { value: 'inactive', label: t('adminPages.ticketUi.inactive') },
            ]}
            icon={CheckCircle2}
            className="md:w-44"
            ariaLabel={t('adminPages.ticketUi.filterStatus')}
          />
        </section>

        <section className="stp-catalog mb-6">
          {!isAdmin && <div className={`stp-columns hidden px-5 pb-3 pt-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 md:grid ${isAdmin ? 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px_auto]' : 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px]'}`}>
            <span>{t('adminPages.ticketUi.package')}</span>
            <span>{t('adminPages.ticketUi.type')}</span>
            <span>{t('adminPages.ticketUi.price')}</span>
            <span>{t('adminPages.ticketUi.status')}</span>
            <span>{t('adminPages.ticketUi.updated')}</span>
            {isAdmin && <span className="text-right">{t('adminPages.ticketUi.actions')}</span>}
          </div>}

          {loadError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">{t('adminPages.ticketUi.dataUnavailable')}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{loadError}</p>
            </div>
          ) : visiblePackages.length > 0 ? (
            isAdmin ? <div className="admin-package-table-scroll" tabIndex={0} role="region" aria-label={t('adminPages.ticketUi.package')}>
              <table>
                <thead><tr>{[t('adminPages.ticketUi.package'), t('adminPages.ticketUi.type'), t('adminPages.ticketUi.price'), t('adminPages.ticketUi.status'), t('adminPages.ticketUi.updated'), t('adminPages.ticketUi.actions')].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{visiblePackages.map((pkg, index) => <PackageRow key={pkg._id} pkg={pkg} t={t} language={language} isAdmin={isAdmin} onEdit={openModal} onDelete={handleDelete} onDetails={setDetailPackage} index={index} rowRef={String(pkg._id).toLowerCase() === verifiedPackageId?.toLowerCase() ? linkedRowRef : undefined} />)}</tbody>
              </table>
            </div> : <div className="stp-rows space-y-3">
              {filteredPackages.map((pkg, index) => (
                <PackageRow
                  key={pkg._id}
                  pkg={pkg}
                  t={t}
                  language={language}
                  isAdmin={isAdmin}
                  onEdit={openModal}
                  onDelete={handleDelete}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-yellow-400/20 bg-yellow-400/10 text-yellow-300">
                <Package size={22} />
              </div>
              <h2 className="text-lg font-black text-white">{packages.length ? t('adminPages.ticketUi.emptyMatch') : t('adminPages.ticketUi.empty')}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-400">
                {packages.length ? t('adminPages.ticketUi.adjustFilters') : t('adminPages.ticketUi.createHint')}
              </p>
              {isAdmin && !packages.length && (
                <button
                  type="button"
                  onClick={() => openModal()}
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-yellow-300 px-5 text-sm font-black text-[#111111] transition hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-200/80"
                >
                  <Plus size={16} /> {t('adminPages.ticketUi.add')}
                </button>
              )}
            </div>
          )}
        </section>

        {isAdmin && <aside className="stp-note mb-4 flex items-start gap-3 rounded-2xl border border-yellow-300/15 bg-gradient-to-r from-yellow-300/[0.08] via-white/[0.025] to-transparent px-4 py-4 text-sm">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-yellow-300/20 bg-yellow-300/10 text-yellow-300">
            <Info size={17} />
          </div>
          <div>
            <p className="font-black text-yellow-200">{t('adminPages.ticketUi.management')}</p>
            <p className="mt-1 font-medium text-slate-400">{t('adminPages.ticketUi.managementHint')}</p>
          </div>
        </aside>}

        {detailPackage && <Dialog open onClose={() => setDetailPackage(null)} className="package-detail-layer">
          <div className="package-detail-backdrop" aria-hidden="true" />
          <div className="package-detail-position">
            <DialogPanel className="package-detail">
              <header className="package-detail-header">
                <span className="package-detail-ticket"><Ticket size={23} aria-hidden="true" /></span>
                <DialogTitle id="package-detail-title">{detailPackage.name}</DialogTitle>
                <button type="button" onClick={() => setDetailPackage(null)} aria-label={t('adminPages.ticketUi.close')} className="package-detail-close"><X size={18} aria-hidden="true" /></button>
              </header>
              <div className="package-detail-body">
                <dl className="package-detail-summary">
                  <div><dt>{t('adminPages.ticketUi.type')}</dt><dd><span className={`package-detail-type ${TYPE_META[detailPackage.type]?.badge || ''}`}>{t(`adminPages.ticketUi.types.${detailPackage.type}`, { defaultValue: TYPE_META[detailPackage.type]?.label || detailPackage.type })}</span></dd></div>
                  <div><dt>{t('adminPages.ticketUi.price')}</dt><dd>{formatCurrency(detailPackage.price, language)}</dd></div>
                  <div><dt>{t('adminPages.ticketUi.capacityRenewal').split(' & ')[0]}</dt><dd>{detailPackage.saleLimit ?? t('adminPages.ticketUi.unlimited')}</dd></div>
                  <div><dt>{t('adminPages.ticketUi.renewalWindow').replace(String(language).startsWith('vi') ? ' (ngày)' : ' (days)', '')}</dt><dd>{detailPackage.isRenewable === false ? t('adminPages.ticketUi.inactive') : t('ticketPackageExtras.days', { count: detailPackage.renewalWindowDays ?? 7 })}</dd></div>
                </dl>
                <div className="package-detail-fields">
                  <div><h3><Gift size={17} aria-hidden="true" />{t('adminPages.ticketUi.benefits')}</h3><div className="package-detail-value">{(detailPackage.benefitsVersion ? detailPackage.displayBenefits || [] : detailPackage.displayBenefits?.length ? detailPackage.displayBenefits : getDefaultBenefitsText(t).split('\n')).join('\n') || '\u2014'}</div></div>
                  <div><h3><FileText size={17} aria-hidden="true" />{t('adminPages.ticketUi.description')}</h3><div className="package-detail-value">{detailPackage.description || '\u2014'}</div></div>
                  <div><h3><Users size={17} aria-hidden="true" />{t('adminPages.ticketUi.maxSlots')}</h3><div className="package-detail-value package-detail-slots">{detailPackage.maxSlots ?? 3}</div></div>
                </div>

              </div>
              <footer className="package-detail-footer">
                <div className="package-detail-status"><span className={`package-detail-status-switch ${detailPackage.isActive ? 'is-active' : ''}`} aria-hidden="true" /><span>{t('adminPages.ticketUi.activePackage')}<span className="sr-only">: {detailPackage.isActive ? t('adminPages.ticketUi.active') : t('adminPages.ticketUi.inactive')}</span></span></div>
                <div className="package-detail-actions"><button type="button" onClick={() => setDetailPackage(null)}>{t('adminPages.ticketUi.cancel')}</button><button type="button" onClick={() => { const pkg = detailPackage; setDetailPackage(null); openModal(pkg); }}><Edit2 size={14} aria-hidden="true" /> {t('adminPages.ticketUi.edit')}</button></div>
              </footer>
            </DialogPanel>
          </div>
        </Dialog>}

        {showModal && (
          <div className="package-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-labelledby="package-modal-title" aria-describedby="package-modal-description" className="package-modal">
              <div className="package-modal-header">
                <div>
                  <h2 id="package-modal-title" className="text-2xl font-black text-white">{editingPackage ? t('adminPages.ticketUi.editTitle') : t('adminPages.ticketUi.createTitle')}</h2>
                  <p id="package-modal-description">{editingPackage ? t('adminPages.ticketUi.editDescription') : t('adminPages.ticketUi.createDescription')}</p>
                </div>
                <button type="button" onClick={() => setShowModal(false)} className="package-modal-close" aria-label={t('adminPages.ticketUi.close')}><X size={18} aria-hidden="true" /></button>
              </div>

              <form onSubmit={handleSubmit} className="package-modal-form">
                <div className="package-modal-body">
              {error && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-400">
                  {error}
                </div>
              )}

                  <div className="package-form-columns">
                    <section className="package-form-section" aria-labelledby="package-details-heading">
                      <h3 id="package-details-heading">{t('adminPages.ticketUi.details')}</h3>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.packageName')}</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                    placeholder={t('adminPages.ticketUi.namePlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.type')}</label>
                    <AdminSelect
                      value={formData.type}
                      onChange={(nextType) => setFormData({ ...formData, type: nextType })}
                      options={[
                        { value: 'weekly', label: t('adminPages.ticketUi.types.weekly') },
                        { value: 'monthly', label: t('adminPages.ticketUi.types.monthly') },
                        { value: 'yearly', label: t('adminPages.ticketUi.types.yearly') },
                        { value: 'custom', label: t('adminPages.ticketUi.types.custom') },
                      ]}
                      icon={Tag}
                      className="w-full"
                      ariaLabel={t('ticketPackageExtras.selectPackageType')}
                      menuAnchor="bottom start"
                      menuClassName="package-select-menu"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.priceVnd')}</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder={t('ticketPackageExtras.pricePlaceholder')}
                    />
                  </div>
                </div>

                {formData.type === 'custom' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[['durationStart', t('adminPages.ticketUi.durationStart')], ['durationEnd', t('adminPages.ticketUi.durationEnd')]].map(([field, label]) => (
                      <div key={field} className="min-w-0 text-xs font-bold text-gray-400">{label}
                        <AdminDateTimePicker label={label} value={formData[field]} onChange={(value) => setFormData((current) => ({ ...current, [field]: value }))} />
                      </div>
                    ))}
                    <p className="sm:col-span-2 text-sm text-gold" role="status">{(() => {
                      const minutes = rangeMinutes(formData.durationStart, formData.durationEnd);
                      return Number.isInteger(minutes) && minutes > 0 && minutes <= 5256000
                        ? t('adminPages.ticketUi.durationTotal', { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 })
                        : t('adminPages.ticketUi.durationInvalid');
                    })()}</p>
                  </div>
                )}

                <label className="block text-xs font-bold text-gray-400">{t('adminPages.ticketUi.benefits')}
                  <textarea value={formData.displayBenefitsText} onChange={(event) => setFormData({ ...formData, displayBenefitsText: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-black p-3 text-sm text-white" />
                </label>


                <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.description')}</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="min-h-[80px] w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                    placeholder={t('adminPages.ticketUi.descriptionPlaceholder')}
                  />
                </div>

                    </section>
                    <section className="package-form-section" aria-labelledby="package-rules-heading">
                      <h3 id="package-rules-heading">{t('adminPages.ticketUi.capacityRenewal')}</h3>
                {formData.type !== 'hourly' && <fieldset className="package-capacity space-y-2">
                  <legend className="px-2 text-sm font-bold text-white">{t('adminPages.ticketUi.membershipCapacity')}</legend>
                  <label htmlFor="package-sale-limit" className="block text-xs font-semibold text-gray-300">{t('adminPages.ticketUi.totalSpaces')}</label>
                  <input id="package-sale-limit" type="number" min="0" step="1" value={formData.saleLimit} onChange={(event) => setFormData({ ...formData, saleLimit: event.target.value })} placeholder={t('adminPages.ticketUi.unlimited')} className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm text-white" />
                  <p className="text-xs leading-5 text-gray-400">{t('ticketPackageExtras.leaveBlankUnlimited')}</p>
                  {editingPackage?.stock && <p className="text-xs text-yellow-100">{t('adminPages.ticketUi.stockSummary', { inUse: editingPackage.stock.allocatedQuantity, holds: editingPackage.stock.heldQuantity, minimum: editingPackage.stock.allocatedQuantity + editingPackage.stock.heldQuantity })}</p>}
                  {editingPackage?.inactiveReason === 'SOLD_OUT' && <p className="text-xs text-yellow-200">{t('adminPages.ticketUi.soldOutHint')}</p>}
                </fieldset>}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.maxSlots')}</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="10"
                      value={formData.maxSlots}
                      onChange={(e) => setFormData({ ...formData, maxSlots: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder={t('ticketPackageExtras.maxSlotsPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">{t('adminPages.ticketUi.renewalWindow')}</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="60"
                      value={formData.renewalWindowDays}
                      onChange={(e) => setFormData({ ...formData, renewalWindowDays: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder={t('ticketPackageExtras.renewalPlaceholder')}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 py-1">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={formData.isRenewable}
                      onChange={(e) => setFormData({ ...formData, isRenewable: e.target.checked })}
                    />
                    <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-gold peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
                    <span className="ml-3 text-sm font-bold text-white">{t('adminPages.ticketUi.allowRenewal')}</span>
                  </label>
                </div>

                <fieldset className="package-services">
                  <legend className="px-2 text-sm font-bold text-white">{t('adminPages.ticketUi.includedServices')}</legend>
                  {benefitServicesError && <p role="alert" className="text-sm text-red-400">{benefitServicesError}</p>}
                  {formData.serviceBenefits.map((benefit, index) => (
                    <div key={index} className="package-service-row">
                      <AdminSelect ariaLabel={`Service ${index + 1}`} required value={benefit.serviceId}
                        onChange={(serviceId) => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.map((item, i) => i === index ? { ...item, serviceId } : item) })}
                        options={[{ value: '', label: t('adminPages.ticketUi.selectService') }, ...benefitServices.map((service) => ({ value: service._id, label: service.name }))]}
                        icon={null} className="package-service-select" menuAnchor="bottom start" menuClassName="package-select-menu" />
                      <input aria-label={t('adminPages.ticketUi.usesPerSpace', { index: index + 1 })} type="number" required min="1" max="10000" step="1" value={benefit.quantityPerSlot} onChange={(event) => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.map((item, i) => i === index ? { ...item, quantityPerSlot: event.target.value } : item) })} className="w-24 rounded-lg border border-white/10 bg-black p-3 text-white" />
                      <button type="button" aria-label={t('adminPages.ticketUi.removeService', { index: index + 1 })} onClick={() => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.filter((_, i) => i !== index) })} className="p-3 text-red-400"><Trash2 size={18} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setFormData({ ...formData, serviceBenefits: [...formData.serviceBenefits, { serviceId: '', quantityPerSlot: 1 }] })} className="min-h-11 text-sm font-bold text-gold">+ {t('adminPages.ticketUi.addService')}</button>
                </fieldset>
                    </section>
                  </div>
                </div>
                <div className="package-modal-footer">
                <div className="package-active-row flex items-center gap-3 py-2">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={formData.isActive}
                      onChange={(e) => { setActiveChanged(true); setFormData({ ...formData, isActive: e.target.checked }); }}
                    />
                    <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-gold peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
                    <span className="ml-3 text-sm font-bold text-white">{t('adminPages.ticketUi.activePackage')}</span>
                  </label>
                </div>

                  <div className="package-modal-actions">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 rounded-xl bg-white/5 px-4 py-3 font-bold text-gray-400 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    {t('adminPages.ticketUi.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={savingPackage}
                    className="flex-1 rounded-xl bg-gold px-4 py-3 font-bold text-[#0B0E17] shadow-lg shadow-gold/20 transition hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-yellow-200/80"
                  >
                    {savingPackage ? t('adminPages.ticketUi.saving') : editingPackage ? t('adminPages.ticketUi.save') : t('adminPages.ticketUi.create')}
                  </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal 
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, packageId: null })}
        onConfirm={executeDelete}
        title={t('adminPages.ticketUi.deleteTitle')}
        message={t('adminPages.ticketUi.deleteMessage')}
        confirmText={t('common.delete', { defaultValue: 'Delete' })}
        cancelText={t('adminPages.ticketUi.cancel')}
        isDestructive={true}
      />
    </div>
  );
}
