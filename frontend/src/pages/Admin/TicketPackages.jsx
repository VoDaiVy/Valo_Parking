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
import ConfirmModal from '../../components/Admin/ConfirmModal';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  getOperationalValue,
  getOperationalViewState,
} from '../../utils/staffOperationalAvailability';

const currencyFormatter = new Intl.NumberFormat('vi-VN');
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

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

const KNOWN_TYPES = ['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];

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


const formatCurrency = (value = 0) => `${currencyFormatter.format(Number(value) || 0)} VND`;

const formatPackageDate = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
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

function PackageRow({ pkg, isAdmin, onEdit, onDelete, onDetails, index, rowRef }) {
  const meta = getTypeMeta(pkg.type);
  const Icon = meta.Icon;
  const isActive = Boolean(pkg.isActive);

  if (isAdmin) return (
    <tr ref={rowRef} data-package-type={pkg.type} className="admin-package-row" tabIndex={0} aria-label={`View details for ${pkg.name || 'package'}`} aria-haspopup="dialog" onClick={() => onDetails(pkg)} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onDetails(pkg);
      }
    }}>
      <td>
        <div className="flex min-w-0 items-center gap-3">
          <Icon size={19} className={`shrink-0 ${meta.icon.split(' ').find((token) => token.startsWith('text-'))}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white" title={pkg.name}>{pkg.name || 'Untitled package'}</p>
            <p className="package-description truncate text-white/40" title={pkg.description}>{pkg.description || 'No description'}</p>
            {pkg.type !== 'hourly' && <p className="mt-2 whitespace-normal text-xs text-white/60">
              Limit {pkg.stock?.saleLimit ?? pkg.saleLimit ?? 'Unlimited'} · In use {pkg.stock?.allocatedQuantity ?? '—'} · Payment holds {pkg.stock?.heldQuantity ?? '—'} · Available {pkg.stock?.remainingQuantity ?? (pkg.saleLimit == null ? 'Unlimited' : '—')}
            </p>}
          </div>
        </div>
      </td>
      <td><span className={`inline-flex rounded-full border px-2.5 py-0.5 ${meta.badge}`}>{meta.label}</span></td>
      <td><p className="font-semibold text-[#e8d5ad]">{formatCurrency(pkg.price)}</p><p className="package-description text-white/40">{meta.unit}</p></td>
      <td><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${isActive ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />{isActive ? 'Active' : 'Inactive'}</span>{!isActive && <p className="mt-2 text-xs text-white/50">{pkg.inactiveReason === 'SOLD_OUT' ? 'No available spaces' : 'Paused by admin'}</p>}</td>
      <td className="text-white/55">{formatPackageDate(pkg.updatedAt || pkg.createdAt)}</td>
      <td>
        <div className="flex items-center justify-end gap-2">

          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(pkg); }} aria-label={`Edit ${pkg.name || 'package'}`} title={`Edit ${pkg.name || 'package'}`} className="package-edit inline-flex h-8 w-8 items-center justify-center text-[#e8d5ad]/75 hover:text-[#e8d5ad] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8d5ad]"><Edit2 size={16} /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(pkg._id); }} aria-label={`Delete ${pkg.name || 'package'}`} title={`Delete ${pkg.name || 'package'}`} className="inline-flex h-8 w-8 items-center justify-center text-red-400 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"><Trash2 size={16} /></button>
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
            <h3 className="truncate text-sm font-black text-white sm:text-base">{pkg.name || 'Untitled package'}</h3>
            <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-400">{pkg.description || 'No description'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Type</span>
          <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${meta.badge}`}>
            {meta.label}
          </span>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Price</span>
          <div className="text-right md:text-left">
            <p className="font-mono text-sm font-black text-white sm:text-base">{formatCurrency(pkg.price)}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{meta.unit}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Status</span>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${
            isActive
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
              : 'border-slate-400/15 bg-white/5 text-slate-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-300' : 'bg-slate-500'}`} />
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Last Updated</span>
          <p className="text-right text-xs font-semibold text-slate-300 md:text-left">{formatPackageDate(pkg.updatedAt || pkg.createdAt)}</p>
        </div>

        {isAdmin && (
          <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3 md:border-t-0 md:pt-0">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onEdit(pkg); }}
              aria-label={`Edit ${pkg.name || 'package'}`}
              title={`Edit ${pkg.name || 'package'}`}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/60 motion-reduce:transition-none"
            >
              <Edit2 size={16} className="transition group-hover:scale-105 motion-reduce:transition-none" />
            </button>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onDelete(pkg._id); }}
              aria-label={`Delete ${pkg.name || 'package'}`}
              title={`Delete ${pkg.name || 'package'}`}
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
    type: 'hourly',
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
      if (!response.ok || !response.data?.success) throw new Error('Unable to load services.');
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
      if (generation !== aiRefreshGeneration.current) return;
      if (packageLinkKey) setPackageLink({ ...ticketPackageLinkState({ ok: res.ok, status: res.status, data }, packageIdQuery), key: packageLinkKey });
      if (res.ok && data.success && Array.isArray(data.data)) {
        setPackages(data.data);
        setLoadError('');
      } else {
        setPackages([]);
        setLoadError(data?.message || 'Failed to load ticket packages');
      }
    } catch (err) {
      if (generation !== aiRefreshGeneration.current) return;
      console.error(err);
      setPackages([]);
      setLoadError('Failed to load ticket packages');
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
        displayBenefitsText: (pkg.benefitsVersion ? pkg.displayBenefits : ['Reserved VIP slots', 'Priority parking access']).join('\n'),
        serviceBenefits: (pkg.serviceBenefits || []).map((benefit) => ({ serviceId: benefit.serviceId, quantityPerSlot: benefit.quantityPerSlot })),
      });
    } else {
      setEditingPackage(null);
      setFormData({
        name: '',
        type: 'hourly',
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
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saveInFlight.current) return;
    setError('');
    if (formData.type !== 'hourly' && formData.saleLimit !== '' && (!Number.isSafeInteger(Number(formData.saleLimit)) || Number(formData.saleLimit) < 0)) {
      setError('Membership space limit must be a whole number of 0 or more, or blank for unlimited.');
      return;
    }
    const durationMinutes = rangeMinutes(formData.durationStart, formData.durationEnd);
    if (formData.type === 'custom' && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 5256000)) {
      setError('Choose an end after the start. Custom duration must be between 1 minute and 3650 days.');
      return;
    }
    if (new Set(formData.serviceBenefits.map((benefit) => benefit.serviceId)).size !== formData.serviceBenefits.length) {
      setError('Select each service once and configure its uses per space.');
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
        setError(data?.message || 'Không thể lưu gói vé. Vui lòng thử lại.');
        return; // Keep modal open so admin can see the error
      }

      setShowModal(false);
      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Không thể kết nối đến server. Vui lòng kiểm tra mạng và thử lại.');
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
        setError(data?.message || 'Không thể xóa gói vé.');
        setDeleteModal({ isOpen: false, packageId: null });
        return;
      }

      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Không thể kết nối đến server khi xóa gói vé.');
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
      latestUpdated: latest ? formatPackageDate(latest) : 'Not available',
    };
  }, [packages]);

  const typeOptions = useMemo(() => {
    const actualTypes = packages.map((pkg) => pkg.type).filter(Boolean);
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
        {packageLinkKey && packageLink.key === packageLinkKey && !['idle', 'ready'].includes(packageLink.status) && <p role={packageLink.status === 'loading' ? 'status' : 'alert'} className="mb-3 text-sm text-yellow-200">{packageLink.status === 'loading' ? 'Locating package...' : packageLink.status === 'missing' ? 'Ticket package not found.' : packageLink.status === 'unavailable' ? 'Package access is unavailable. Check your sign-in and permissions.' : 'Unable to verify the linked package. Please refresh.'}</p>}
        <header className="stp-header mb-8 flex animate-[fadeIn_420ms_ease-out_both] flex-col justify-between gap-4 motion-reduce:animate-none md:flex-row md:items-end">
          <div>
            {isAdmin ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">Ticket Packages</h1>
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black text-yellow-300"><Tag size={12} /> Packages</div>
            </div> : <>
            <div className="stp-legacy-label mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <Tag size={12} /> Packages
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Ticket Packages</h1>
            </>}
            <p className="mt-2 text-sm font-medium text-slate-400">Manage parking rates and ticket packages.</p>
          </div>

          {!isAdmin && <button type="button" onClick={fetchPackages} disabled={loading} aria-busy={loading} aria-label="Refresh packages" title="Refresh packages" className="stp-refresh">
            <RefreshCw size={17} aria-hidden="true" className={loading ? 'animate-spin' : ''} /><span>Refresh</span>
          </button>}

          {isAdmin && (
            <button
              type="button"
              onClick={() => openModal()}
              className="admin-package-add group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-500 px-6 text-sm font-black text-[#111111] shadow-lg shadow-yellow-500/20 transition hover:-translate-y-0.5 hover:shadow-yellow-500/30 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-yellow-200/80 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <Plus size={18} className="transition group-hover:rotate-90 motion-reduce:transition-none" />
              Add Package
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
              Retry
            </button>
          </div>
        )}

        <section className="stp-metrics mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/20 sm:grid-cols-3">
          <SummaryItem
            isAdmin={isAdmin}
            icon={Package}
            label="Total Packages"
            value={getOperationalValue(packageState, summary.total.toLocaleString('vi-VN'))}
            support={packageState.isAvailable ? 'Loaded packages' : 'Data unavailable'}
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={CheckCircle2}
            label="Active Packages"
            value={getOperationalValue(packageState, summary.active.toLocaleString('vi-VN'))}
            support={packageState.isAvailable ? 'Enabled and visible' : 'Data unavailable'}
            tone="text-emerald-300"
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={CalendarClock}
            label="Last Updated"
            value={getOperationalValue(packageState, summary.latestUpdated.split(' ')[0])}
            support={packageState.isAvailable ? (summary.latestUpdated.split(' ').slice(1).join(' ') || 'No timestamp') : 'Data unavailable'}
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
              placeholder="Search packages by name..."
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-11 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-300/50 focus:ring-2 focus:ring-yellow-300/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear package search"
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
              { value: 'all', label: 'All types' },
              ...typeOptions.map((type) => ({ value: type, label: getTypeMeta(type).label })),
            ]}
            icon={Tag}
            className="md:w-44"
            ariaLabel="Filter packages by type"
          />

          <AdminSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            icon={CheckCircle2}
            className="md:w-44"
            ariaLabel="Filter packages by status"
          />
        </section>

        <section className="stp-catalog mb-6">
          {!isAdmin && <div className={`stp-columns hidden px-5 pb-3 pt-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 md:grid ${isAdmin ? 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px_auto]' : 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px]'}`}>
            <span>Package</span>
            <span>Type</span>
            <span>Price</span>
            <span>Status</span>
            <span>Last Updated</span>
            {isAdmin && <span className="text-right">Actions</span>}
          </div>}

          {loadError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">Ticket package data unavailable</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{loadError}</p>
            </div>
          ) : visiblePackages.length > 0 ? (
            isAdmin ? <div className="admin-package-table-scroll" tabIndex={0} role="region" aria-label="Ticket packages list">
              <table>
                <thead><tr>{['Package', 'Type', 'Price', 'Status', 'Last Updated', 'Actions'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{visiblePackages.map((pkg, index) => <PackageRow key={pkg._id} pkg={pkg} isAdmin={isAdmin} onEdit={openModal} onDelete={handleDelete} onDetails={setDetailPackage} index={index} rowRef={String(pkg._id).toLowerCase() === verifiedPackageId?.toLowerCase() ? linkedRowRef : undefined} />)}</tbody>
              </table>
            </div> : <div className="stp-rows space-y-3">
              {filteredPackages.map((pkg, index) => (
                <PackageRow
                  key={pkg._id}
                  pkg={pkg}
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
              <h2 className="text-lg font-black text-white">{packages.length ? 'No matching packages' : 'No ticket packages yet'}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-400">
                {packages.length ? 'Adjust the search or filters to see more packages.' : 'Create a package to start managing parking ticket rates.'}
              </p>
              {isAdmin && !packages.length && (
                <button
                  type="button"
                  onClick={() => openModal()}
                  className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-yellow-300 px-5 text-sm font-black text-[#111111] transition hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-200/80"
                >
                  <Plus size={16} /> Add Package
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
            <p className="font-black text-yellow-200">Package management</p>
            <p className="mt-1 font-medium text-slate-400">Review package changes carefully before saving.</p>
          </div>
        </aside>}

        {detailPackage && <Dialog open onClose={() => setDetailPackage(null)} className="package-detail-layer">
          <div className="package-detail-backdrop" aria-hidden="true" />
          <div className="package-detail-position">
            <DialogPanel className="package-detail">
              <header className="package-detail-header">
                <span className="package-detail-ticket"><Ticket size={23} aria-hidden="true" /></span>
                <DialogTitle id="package-detail-title">{detailPackage.name}</DialogTitle>
                <button type="button" onClick={() => setDetailPackage(null)} aria-label="Close package details" className="package-detail-close"><X size={18} aria-hidden="true" /></button>
              </header>
              <div className="package-detail-body">
                <dl className="package-detail-summary">
                  <div><dt>Type</dt><dd><span className={`package-detail-type ${TYPE_META[detailPackage.type]?.badge || ''}`}>{TYPE_META[detailPackage.type]?.label || detailPackage.type}</span></dd></div>
                  <div><dt>Price</dt><dd>{formatCurrency(detailPackage.price)}</dd></div>
                  <div><dt>Capacity</dt><dd>{detailPackage.saleLimit ?? 'Unlimited'}</dd></div>
                  <div><dt>Renewal</dt><dd>{detailPackage.isRenewable === false ? 'Off' : `${detailPackage.renewalWindowDays ?? 7} days`}</dd></div>
                </dl>
                <div className="package-detail-fields">
                  <div><h3><Gift size={17} aria-hidden="true" />Benefits</h3><div className="package-detail-value">{(detailPackage.benefitsVersion ? detailPackage.displayBenefits || [] : detailPackage.displayBenefits?.length ? detailPackage.displayBenefits : ['Reserved VIP slots', 'Priority parking access']).join('\n') || '\u2014'}</div></div>
                  <div><h3><FileText size={17} aria-hidden="true" />Description</h3><div className="package-detail-value">{detailPackage.description || '\u2014'}</div></div>
                  <div><h3><Users size={17} aria-hidden="true" />Max Slots per Purchase</h3><div className="package-detail-value package-detail-slots">{detailPackage.maxSlots ?? 3}</div></div>
                </div>

              </div>
              <footer className="package-detail-footer">
                <div className="package-detail-status"><span className={`package-detail-status-switch ${detailPackage.isActive ? 'is-active' : ''}`} aria-hidden="true" /><span>Active Package<span className="sr-only">: {detailPackage.isActive ? 'Active' : 'Inactive'}</span></span></div>
                <div className="package-detail-actions"><button type="button" onClick={() => setDetailPackage(null)}>Cancel</button><button type="button" onClick={() => { const pkg = detailPackage; setDetailPackage(null); openModal(pkg); }}><Edit2 size={14} aria-hidden="true" /> Edit</button></div>
              </footer>
            </DialogPanel>
          </div>
        </Dialog>}

        {showModal && (
          <div className="package-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-labelledby="package-modal-title" aria-describedby="package-modal-description" className="package-modal">
              <div className="package-modal-header">
                <div>
                  <h2 id="package-modal-title" className="text-2xl font-black text-white">{editingPackage ? 'Edit Package' : 'Create Package'}</h2>
                  <p id="package-modal-description">{editingPackage ? 'Update package details and availability.' : 'Set parking rates and package availability.'}</p>
                </div>
                <button type="button" onClick={() => setShowModal(false)} className="package-modal-close" aria-label="Close package dialog"><X size={18} aria-hidden="true" /></button>
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
                      <h3 id="package-details-heading">Package details</h3>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Package Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                    placeholder="e.g. Standard Hourly"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Type</label>
                    <AdminSelect
                      value={formData.type}
                      onChange={(nextType) => setFormData({ ...formData, type: nextType })}
                      options={[
                        { value: 'hourly', label: 'Hourly' },
                        { value: 'daily', label: 'Daily' },
                        { value: 'weekly', label: 'Weekly' },
                        { value: 'monthly', label: 'Monthly' },
                        { value: 'yearly', label: 'Yearly' },
                        { value: 'custom', label: 'Custom duration' },
                      ]}
                      icon={Tag}
                      className="w-full"
                      ariaLabel="Select ticket package type"
                      menuAnchor="bottom start"
                      menuClassName="package-select-menu"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Price (VND)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder="e.g. 10000"
                    />
                  </div>
                </div>

                {formData.type === 'custom' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[['durationStart', 'From date and time'], ['durationEnd', 'To date and time']].map(([field, label]) => (
                      <div key={field} className="min-w-0 text-xs font-bold text-gray-400">{label}
                        <AdminDateTimePicker label={label} value={formData[field]} onChange={(value) => setFormData((current) => ({ ...current, [field]: value }))} />
                      </div>
                    ))}
                    <p className="sm:col-span-2 text-sm text-gold" role="status">{(() => {
                      const minutes = rangeMinutes(formData.durationStart, formData.durationEnd);
                      return Number.isInteger(minutes) && minutes > 0 && minutes <= 5256000
                        ? `Total: ${Math.floor(minutes / 1440)} days ${Math.floor(minutes % 1440 / 60)} hours ${minutes % 60} minutes`
                        : 'Choose an end after the start (maximum 3650 days).';
                    })()}</p>
                  </div>
                )}

                <label className="block text-xs font-bold text-gray-400">Benefits (one per line)
                  <textarea value={formData.displayBenefitsText} onChange={(event) => setFormData({ ...formData, displayBenefitsText: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-black p-3 text-sm text-white" />
                </label>


                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="min-h-[80px] w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                    placeholder="Optional description"
                  />
                </div>

                    </section>
                    <section className="package-form-section" aria-labelledby="package-rules-heading">
                      <h3 id="package-rules-heading">Capacity & renewal</h3>
                {formData.type !== 'hourly' && <fieldset className="package-capacity space-y-2">
                  <legend className="px-2 text-sm font-bold text-white">Membership capacity</legend>
                  <label htmlFor="package-sale-limit" className="block text-xs font-semibold text-gray-300">Total membership spaces for this package</label>
                  <input id="package-sale-limit" type="number" min="0" step="1" value={formData.saleLimit} onChange={(event) => setFormData({ ...formData, saleLimit: event.target.value })} placeholder="Unlimited" className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm text-white" />
                  <p className="text-xs leading-5 text-gray-400">Leave blank for unlimited.</p>
                  {editingPackage?.stock && <p className="text-xs text-yellow-100">In use {editingPackage.stock.allocatedQuantity} · Holds {editingPackage.stock.heldQuantity} · Minimum {editingPackage.stock.allocatedQuantity + editingPackage.stock.heldQuantity}</p>}
                  {editingPackage?.inactiveReason === 'SOLD_OUT' && <p className="text-xs text-yellow-200">Sold out. Increase capacity to reopen.</p>}
                </fieldset>}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Max Slots per Purchase</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="10"
                      value={formData.maxSlots}
                      onChange={(e) => setFormData({ ...formData, maxSlots: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Renewal Window (days)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      max="60"
                      value={formData.renewalWindowDays}
                      onChange={(e) => setFormData({ ...formData, renewalWindowDays: Number(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                      placeholder="e.g. 7"
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
                    <span className="ml-3 text-sm font-bold text-white">Allow Renewal</span>
                  </label>
                </div>

                <fieldset className="package-services">
                  <legend className="px-2 text-sm font-bold text-white">Included services per space</legend>
                  {benefitServicesError && <p role="alert" className="text-sm text-red-400">{benefitServicesError}</p>}
                  {formData.serviceBenefits.map((benefit, index) => (
                    <div key={index} className="package-service-row">
                      <AdminSelect ariaLabel={`Service ${index + 1}`} required value={benefit.serviceId}
                        onChange={(serviceId) => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.map((item, i) => i === index ? { ...item, serviceId } : item) })}
                        options={[{ value: '', label: 'Select service' }, ...benefitServices.map((service) => ({ value: service._id, label: service.name }))]}
                        icon={null} className="package-service-select" menuAnchor="bottom start" menuClassName="package-select-menu" />
                      <input aria-label={`Uses per space ${index + 1}`} type="number" required min="1" max="10000" step="1" value={benefit.quantityPerSlot} onChange={(event) => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.map((item, i) => i === index ? { ...item, quantityPerSlot: event.target.value } : item) })} className="w-24 rounded-lg border border-white/10 bg-black p-3 text-white" />
                      <button type="button" aria-label={`Remove service ${index + 1}`} onClick={() => setFormData({ ...formData, serviceBenefits: formData.serviceBenefits.filter((_, i) => i !== index) })} className="p-3 text-red-400"><Trash2 size={18} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setFormData({ ...formData, serviceBenefits: [...formData.serviceBenefits, { serviceId: '', quantityPerSlot: 1 }] })} className="min-h-11 text-sm font-bold text-gold">+ Add service</button>
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
                    <span className="ml-3 text-sm font-bold text-white">Active Package</span>
                  </label>
                </div>

                  <div className="package-modal-actions">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 rounded-xl bg-white/5 px-4 py-3 font-bold text-gray-400 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingPackage}
                    className="flex-1 rounded-xl bg-gold px-4 py-3 font-bold text-[#0B0E17] shadow-lg shadow-gold/20 transition hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-yellow-200/80"
                  >
                    {savingPackage ? 'Saving...' : editingPackage ? 'Save Package' : 'Create Package'}
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
        title="Delete Package"
        message="Are you sure you want to delete this package? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isDestructive={true}
      />
    </div>
  );
}
