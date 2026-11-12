import PackageFormSelect from './PackageFormSelect';
import { defaultPackageDuration, packageDurationLabel as durationLabel, localSalesDate, packageSalesAvailability } from '../../utils/ticketPackageTerms';
import PackageTermsSummary from '../../components/membership/PackageTermsSummary';
import { API_BASE } from '../../services/api';
import { useEffect, useRef, useMemo, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import './packageDialog.css';
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
  Info,
  Package,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import '../Staff/components/staffTicketPackages.css';
import './ticketPackages.css';
import AdminSelect from '../../components/Admin/AdminSelect';
import ConfirmModal from '../../components/Admin/ConfirmModal';
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

const KNOWN_TYPES = ['hourly', 'daily', 'monthly', 'yearly'];
const serviceLabel = (service) => ({ RESERVED_FREE: 'Reserved space: base parking included', RESERVED_PAID: 'Reserved space: standard parking fees' }[service] || 'Existing purchased terms');

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

function PackageRow({ pkg, isAdmin, onEdit, onView, onDelete, index, rowRef }) {
  const meta = getTypeMeta(pkg.type);
  const Icon = meta.Icon;
  const isActive = Boolean(pkg.isActive);

  if (isAdmin) return (
    <tr ref={rowRef} data-package-type={pkg.type} className="admin-package-row">
      <td>
        <div className="flex min-w-0 items-center gap-3">
          <Icon size={19} className={`shrink-0 ${meta.icon.split(' ').find((token) => token.startsWith('text-'))}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white" title={pkg.name}>{pkg.name || 'Untitled package'}</p>
            <p className="package-description truncate text-white/40" title={pkg.description}>{pkg.description || 'No description'}</p>
          </div>
        </div>
      </td>
      <td><span className={`inline-flex rounded-full border px-2.5 py-0.5 ${meta.badge}`}>{meta.label}</span></td>
      <td><p className="font-semibold text-[#e8d5ad]">{formatCurrency(pkg.price)}</p><p className="package-description text-white/40">{durationLabel(pkg)}</p><p className="package-description text-white/50">{serviceLabel(pkg.service)}</p>{pkg.optionalServices?.length > 0 && <p className="package-description text-white/50">Optional, paid separately: {pkg.optionalServices.map((item) => item.name).join(', ')}</p>}<p className="package-description text-white/50">{packageSalesAvailability(pkg).message}{pkg.salesEndAt ? ` Sales end: ${new Date(pkg.salesEndAt).toLocaleString('en-GB')}` : ''}</p></td>
      <td><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${isActive ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />{isActive ? 'Active' : 'Inactive'}</span></td>
      <td className="text-white/55">{formatPackageDate(pkg.updatedAt || pkg.createdAt)}</td>
      <td>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => onView(pkg)} aria-label={`View ${pkg.name}`} title="Package details" className="inline-flex h-8 w-8 items-center justify-center text-white/60 hover:text-[#e8d5ad]"><Info size={16} /></button>
          <button type="button" onClick={() => onEdit(pkg)} aria-label={`Edit ${pkg.name || 'package'}`} title={`Edit ${pkg.name || 'package'}`} className="package-edit inline-flex h-8 w-8 items-center justify-center text-[#e8d5ad]/75 hover:text-[#e8d5ad] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8d5ad]"><Edit2 size={16} /></button>
          <button type="button" onClick={() => onDelete(pkg._id)} aria-label={`Delete ${pkg.name || 'package'}`} title={`Delete ${pkg.name || 'package'}`} className="inline-flex h-8 w-8 items-center justify-center text-red-400 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"><Trash2 size={16} /></button>
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
            <h3 className="truncate text-sm font-black text-white sm:text-base"><button type="button" onClick={() => onView(pkg)} className="text-left hover:underline">{pkg.name || 'Untitled package'}</button></h3>
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
            <p className="mt-0.5 text-xs font-semibold text-slate-500">{durationLabel(pkg)}</p><p className="package-description text-white/50">{serviceLabel(pkg.service)}</p>{pkg.optionalServices?.length > 0 && <p className="package-description text-white/50">Optional, paid separately: {pkg.optionalServices.map((item) => item.name).join(', ')}</p>}<p className="package-description text-white/50">{packageSalesAvailability(pkg).message}{pkg.salesEndAt ? ` Sales end: ${new Date(pkg.salesEndAt).toLocaleString('en-GB')}` : ''}</p>
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
              onClick={() => onEdit(pkg)}
              aria-label={`Edit ${pkg.name || 'package'}`}
              title={`Edit ${pkg.name || 'package'}`}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/60 motion-reduce:transition-none"
            >
              <Edit2 size={16} className="transition group-hover:scale-105 motion-reduce:transition-none" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(pkg._id)}
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
  const [viewOnly, setViewOnly] = useState(false);
  const packageDialogRef = useRef(null);
  const packageErrorRef = useRef(null);
  useEffect(() => {
    if (showModal && error) packageErrorRef.current?.focus();
  }, [showModal, error]);

  // Follow the visible viewport when a mobile keyboard opens or the page pans.
  useEffect(() => {
    if (!showModal || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      packageDialogRef.current?.style.setProperty('--package-viewport-height', `${viewport.height}px`);
      packageDialogRef.current?.style.setProperty('--package-viewport-top', `${viewport.offsetTop}px`);
    };
    syncViewport();
    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
    };
  }, [showModal]);
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, packageId: null });
  const [editingPackage, setEditingPackage] = useState(null);
  const [saving, setSaving] = useState(false);
  const packageState = getOperationalViewState({ loading, error: loadError });

  const [formData, setFormData] = useState({
    name: '',
    type: 'hourly',
    price: '',
    description: '',
    isActive: true,
    maxSlots: 3,
    service: '',
    duration: defaultPackageDuration('hourly'), salesStartAt: '', salesEndAt: '', optionalServiceIds: [],
    renewalWindowDays: 7,
    isRenewable: true,
  });

  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceCatalogError, setServiceCatalogError] = useState('');
  useEffect(() => {
    if (!showModal) return;
    let cancelled = false;
    fetch(`${API_BASE}/services?activeOnly=false`)
      .then(async (response) => { const data = await response.json(); if (!response.ok || !data.success) throw new Error('Unable to load services.'); return data.data; })
      .then((data) => { if (!cancelled) { setServiceCatalog(data); setServiceCatalogError(''); } })
      .catch(() => { if (!cancelled) setServiceCatalogError('Unable to load the service catalog. Existing selections are preserved.'); });
    return () => { cancelled = true; };
  }, [showModal]);

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
      const res = await fetch(`${API_BASE}/ticket-packages`, {
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

  const openModal = (pkg = null, readOnly = false) => {
    setViewOnly(readOnly);
    setError('');
    if (pkg) {
      setEditingPackage(pkg);
      setFormData({
        name: pkg.name,
        type: pkg.type,
        price: pkg.price,
        description: pkg.description || '',
        isActive: pkg.isActive,
        maxSlots: pkg.maxSlots ?? 3,
        service: pkg.service || '',
        duration: pkg.duration?.value ? pkg.duration : defaultPackageDuration(pkg.type),
        salesStartAt: localSalesDate(pkg.salesStartAt), salesEndAt: localSalesDate(pkg.salesEndAt),
        optionalServiceIds: (pkg.optionalServiceIds || []).map(String),
        renewalWindowDays: pkg.renewalWindowDays ?? 7,
        isRenewable: pkg.isRenewable ?? true,
      });
    } else {
      setEditingPackage(null);
      setFormData({
        name: '',
        type: 'hourly',
        price: '',
        description: '',
        isActive: true,
        maxSlots: 3,
        service: '',
        duration: defaultPackageDuration('hourly'), salesStartAt: '', salesEndAt: '', optionalServiceIds: [],
        renewalWindowDays: 7,
        isRenewable: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || viewOnly || !isAdmin) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...formData, price: Number(formData.price),
        salesStartAt: formData.salesStartAt ? new Date(formData.salesStartAt).toISOString() : null,
        salesEndAt: formData.salesEndAt ? new Date(formData.salesEndAt).toISOString() : null,
      };
      if (!payload.service) delete payload.service;
      const config = {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      };

      const url = editingPackage
        ? `${API_BASE}/ticket-packages/${editingPackage._id}`
        : `${API_BASE}/ticket-packages`;
      const method = editingPackage ? 'PUT' : 'POST';

      const res = await fetch(url, { method, ...config, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        setError(data?.message || 'Unable to save this package.');
        return; // Keep modal open so admin can see the error
      }

      setShowModal(false);
      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Unable to connect to the server while saving this package.');
    } finally { setSaving(false); }
  };


  const handleDelete = (id) => {
    setDeleteModal({ isOpen: true, packageId: id });
  };

  const executeDelete = async () => {
    const { packageId } = deleteModal;
    if (!packageId) return;
    try {
      const res = await fetch(`${API_BASE}/ticket-packages/${packageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.success === false) {
        setError(data?.message || 'Unable to delete this package.');
        setDeleteModal({ isOpen: false, packageId: null });
        return;
      }

      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Unable to connect to the server while deleting this package.');
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

        {error && !showModal && <p role="alert" className="mb-4 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
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
                <tbody>{visiblePackages.map((pkg, index) => <PackageRow key={pkg._id} pkg={pkg} isAdmin={isAdmin} onEdit={openModal} onView={(pkg) => openModal(pkg, true)} onDelete={handleDelete} index={index} rowRef={String(pkg._id).toLowerCase() === verifiedPackageId?.toLowerCase() ? linkedRowRef : undefined} />)}</tbody>
              </table>
            </div> : <div className="stp-rows space-y-3">
              {filteredPackages.map((pkg, index) => (
                <PackageRow
                  key={pkg._id}
                  pkg={pkg}
                  isAdmin={isAdmin}
                  onEdit={openModal} onView={(pkg) => openModal(pkg, true)}
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

        <Dialog open={showModal} onClose={() => { if (!saving) setShowModal(false); }} className={`package-dialog${isAdmin && !viewOnly ? ' package-dialog--editor' : ''}`}>
          <div className="package-dialog-backdrop" aria-hidden="true" />
          <div ref={packageDialogRef} className="package-dialog-viewport">
            <DialogPanel className="package-dialog-panel">
              <header className="package-dialog-header">
                <div>
                  <DialogTitle className="package-dialog-title">{viewOnly ? 'Package Details' : editingPackage ? 'Edit Package' : 'Create Package'}</DialogTitle>
                  <Description className="package-dialog-description">Set parking rates and package availability.</Description>
                  {isAdmin && !viewOnly && <span className="package-flat-info" tabIndex={0} role="note" aria-label="Package configuration help">Configuration notes <Info size={13} aria-hidden="true" /><span className="package-flat-info-content">Monthly defaults to 720 hours; Yearly defaults to 12 calendar months. Calendar months clamp to the last valid day. Purchased terms are protected: create another package to change a purchased configuration. Active names and configurations must be unique. Sales dates use local time and affect new orders only. Existing benefits, pending PayOS payments and eligible renewals retain their original terms. Inactive stops new purchases. Max Spaces is per purchase, with no global quantity limit.</span></span>}
                </div>
                <button type="button" autoFocus onClick={() => setShowModal(false)} className="package-dialog-close" aria-label="Close package dialog"><X size={20} aria-hidden="true" /></button>
              </header>
              <form onSubmit={handleSubmit} className="package-dialog-form">
                <div className="package-dialog-body" role="region" aria-label="Package form fields" tabIndex={0}>
                <fieldset disabled={viewOnly || saving} className="package-dialog-fields">
                  {isAdmin && !viewOnly ? <>
                  {error && <div ref={packageErrorRef} role="alert" tabIndex={-1} className="package-dialog-error">{error}</div>}
                  <div className="package-flat-column">
                    <div className="package-dialog-field"><label htmlFor="package-name">Package Name <span aria-hidden="true">*</span></label>
                      <input id="package-name" name="name" type="text" required maxLength={120} pattern=".*\S.*" title="Enter a package name with at least one non-space character." value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Standard Monthly" />
                    </div>
                    <div className="package-dialog-grid">
                      <div className="package-dialog-field"><label htmlFor="package-type">Type <span aria-hidden="true">*</span></label>
                        <PackageFormSelect id="package-type" label="Type" value={formData.type} required disabled={saving} onChange={(type) => setFormData({ ...formData, type, duration: defaultPackageDuration(type) })} options={[{ value: 'hourly', label: 'Hourly' }, ...(editingPackage?.type === 'daily' ? [{ value: 'daily', label: 'Daily (legacy)' }] : []), { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
                      </div>
                      <div className="package-dialog-field"><label htmlFor="package-price">Price (VND) <span aria-hidden="true">*</span></label>
                        <input id="package-price" name="price" type="number" inputMode="numeric" required min="0" step="1" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} placeholder="e.g. 300000" title="Whole VND amounts, minimum 0" />
                      </div>
                    </div>
                    <div className="package-dialog-field"><label htmlFor="package-description">Description <span className="package-dialog-optional">Optional</span></label>
                      <textarea id="package-description" name="description" rows={2} maxLength={1000} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Add package details" />
                    </div>
                    <div className="package-dialog-grid package-flat-separated">
                      <div className="package-dialog-field"><label htmlFor="package-duration">Duration <span aria-hidden="true">*</span></label>
                        <input id="package-duration" type="number" required min="1" step="1" value={formData.duration.value} onChange={(e) => setFormData({ ...formData, duration: { ...formData.duration, value: Number(e.target.value) } })} />
                      </div>
                      <div className="package-dialog-field"><label htmlFor="package-duration-unit">Duration Unit</label>
                        <PackageFormSelect id="package-duration-unit" label="Duration unit" disabled={saving} value={formData.duration.unit === 'months' ? 'calendarMonths' : formData.duration.unit} onChange={(unit) => setFormData({ ...formData, duration: { ...formData.duration, unit } })} options={[{ value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days (24 hours)' }, { value: 'calendarMonths', label: 'Calendar months' }]} />
                      </div>
                    </div>
                    <div className="package-dialog-grid">
                      <div className="package-dialog-field"><label htmlFor="package-slots">Max Spaces <span aria-hidden="true">*</span></label>
                        <input id="package-slots" name="maxSlots" type="number" inputMode="numeric" required min="1" max="10" step="1" value={formData.maxSlots} onChange={(e) => setFormData({ ...formData, maxSlots: Number(e.target.value) })} title="1-10 spaces per purchase; no global sales quantity limit" />
                      </div>
                      <div className="package-dialog-field"><label htmlFor="package-renewal-window">Renewal Window (days) <span aria-hidden="true">*</span></label>
                        <input id="package-renewal-window" name="renewalWindowDays" type="number" inputMode="numeric" required min="1" max="60" step="1" value={formData.renewalWindowDays} onChange={(e) => setFormData({ ...formData, renewalWindowDays: Number(e.target.value) })} title="1-60 days" />
                      </div>
                    </div>
                    {formData.type === 'hourly' && <p className="package-dialog-hint">Hourly packages do not support renewal.</p>}
                  </div>
                  <div className="package-flat-column package-flat-right">
                    <div className="package-dialog-field"><label htmlFor="package-service">Parking Service <span aria-hidden="true">*</span></label>
                      <PackageFormSelect id="package-service" label="Parking service" value={formData.service} required={!editingPackage} disabled={saving} placeholder={editingPackage ? 'Existing purchased terms' : 'Select a parking service'} onChange={(service) => setFormData({ ...formData, service })} options={[{ value: '', label: editingPackage ? 'Existing purchased terms' : 'Select a parking service' }, { value: 'RESERVED_FREE', label: 'Reserved space - base parking included' }, { value: 'RESERVED_PAID', label: 'Reserved space - standard parking fees' }]} />
                    </div>
                    <div className="package-dialog-field"><label htmlFor="package-optional-services">Optional Services <span className="package-dialog-optional">Paid separately</span></label>
                      <PackageFormSelect id="package-optional-services" label="Optional services" multiple disabled={saving} value={formData.optionalServiceIds} onChange={(optionalServiceIds) => setFormData({ ...formData, optionalServiceIds })} options={[
                        ...serviceCatalog.filter((item) => item.isActive || formData.optionalServiceIds.includes(String(item._id))).map((item) => ({ value: String(item._id), label: item.name, detail: item.isActive ? undefined : 'Inactive catalog service' })),
                        ...formData.optionalServiceIds.filter((id) => !serviceCatalog.some((item) => String(item._id) === id)).map((id) => ({ value: id, label: `Existing service ${id}` })),
                      ]} />
                      {serviceCatalogError && <p className="package-dialog-hint" role="alert">{serviceCatalogError}</p>}
                    </div>
                    <div className="package-dialog-grid package-flat-separated">
                      <div className="package-dialog-field"><label htmlFor="package-sales-start">Sales Start <span className="package-dialog-optional">Optional</span></label><input id="package-sales-start" type="datetime-local" value={formData.salesStartAt} onChange={(e) => setFormData({ ...formData, salesStartAt: e.target.value })} title="Local time. Leave blank for no start restriction." /></div>
                      <div className="package-dialog-field"><label htmlFor="package-sales-end">Sales End <span className="package-dialog-optional">Optional</span></label><input id="package-sales-end" type="datetime-local" value={formData.salesEndAt} min={formData.salesStartAt || undefined} onChange={(e) => setFormData({ ...formData, salesEndAt: e.target.value })} title="Local time. Leave blank for no end restriction." /></div>
                    </div>
                    <div className="package-flat-switches package-flat-separated">
                      <label className="package-dialog-toggle"><input type="checkbox" name="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} /><span className="package-dialog-switch" aria-hidden="true" /><span>Active Package</span></label>
                      <label className="package-dialog-toggle"><input type="checkbox" name="isRenewable" checked={formData.isRenewable} onChange={(e) => setFormData({ ...formData, isRenewable: e.target.checked })} /><span className="package-dialog-switch" aria-hidden="true" /><span>Allow Renewal</span></label>
                    </div>
                    <p className="package-flat-summary">{formData.service === 'RESERVED_FREE' ? 'Base parking included at the registered space.' : formData.service === 'RESERVED_PAID' ? 'Standard parking fees apply at the registered space.' : 'Purchased parking benefits remain unchanged.'} Additional services are paid separately.</p>
                    <p className="package-dialog-hint">Sales dates stop new orders only. Existing benefits remain valid.</p>
                  </div>
                  </> : <>
                  {error && <div ref={packageErrorRef} role="alert" tabIndex={-1} className="package-dialog-error">{error}</div>}
                  {editingPackage && <p className="package-dialog-hint package-dialog-notice" role="note">Purchased terms are protected. To change a purchased configuration, create a new package and deactivate the original.</p>}
                  <div className="package-dialog-details">
                  <div className="package-dialog-field">
                    <label htmlFor="package-name">Package Name <span aria-hidden="true">*</span></label>
                    <input id="package-name" name="name" type="text" required maxLength={120} pattern=".*\S.*" title="Enter a package name with at least one non-space character."
                      value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Standard Hourly" />
                  </div>
                  <div className="package-dialog-grid">
                    <div className="package-dialog-field">
                      <label htmlFor="package-type">Type <span aria-hidden="true">*</span></label>
                      <select id="package-type" name="type" required value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value, duration: defaultPackageDuration(e.target.value) })}>
                        <option value="hourly">Hourly</option>
                        {editingPackage?.type === 'daily' && <option value="daily">Daily (legacy)</option>}
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div className="package-dialog-field">
                      <label htmlFor="package-price">Price (VND) <span aria-hidden="true">*</span></label>
                      <input id="package-price" name="price" type="number" inputMode="numeric" required min="0" step="1"
                        value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} placeholder="e.g. 10000" aria-describedby="package-price-hint" />
                      <p id="package-price-hint" className="package-dialog-hint">Whole VND amounts, minimum 0</p>
                    </div>
                  </div>
                  <div className="package-dialog-field">
                    <label htmlFor="package-description">Description <span className="package-dialog-optional">Optional</span></label>
                    <textarea id="package-description" name="description" rows={2} maxLength={1000}
                      value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Add package details" />
                  </div>

                  <div className="package-dialog-field">
                    <label htmlFor="package-duration">Duration</label>
                    <input id="package-duration" type="number" required min="1" step="1" value={formData.duration.value} onChange={(e) => setFormData({ ...formData, duration: { ...formData.duration, value: Number(e.target.value) } })} />
                    <label htmlFor="package-duration-unit">Duration unit</label>
                    <select id="package-duration-unit" value={formData.duration.unit === 'months' ? 'calendarMonths' : formData.duration.unit} onChange={(e) => setFormData({ ...formData, duration: { ...formData.duration, unit: e.target.value } })}><option value="hours">Hours</option><option value="days">Days (24 hours)</option><option value="calendarMonths">Calendar months</option></select>
                    <p className="package-dialog-hint">Hourly packages do not support renewal under the existing renewal policy.</p>
                    <p className="package-dialog-hint">Legacy defaults: Monthly = 720 hours; Yearly = 12 calendar months. Calendar months clamp to the last valid day. Existing purchases keep their terms.</p>
                  </div>
                  <div className="package-dialog-field">
                    <label htmlFor="package-service">Parking service</label>
                    <select id="package-service" required={!editingPackage} value={formData.service} onChange={(e) => setFormData({ ...formData, service: e.target.value })}>
                      <option value="">{editingPackage ? 'Existing purchased terms' : 'Select a parking service'}</option>
                      <option value="RESERVED_FREE">Reserved space: base parking included</option>
                      <option value="RESERVED_PAID">Reserved space: standard parking fees</option>
                    </select>
                    <p className="package-dialog-hint">Applies only to the selected vehicle and registered space. Additional services are charged separately.</p>
                  </div>
                  <div className="package-dialog-grid">
                    <div className="package-dialog-field"><label htmlFor="package-sales-start">Sales start (optional, local time)</label><input id="package-sales-start" type="datetime-local" value={formData.salesStartAt} onChange={(e) => setFormData({ ...formData, salesStartAt: e.target.value })} /></div>
                    <div className="package-dialog-field"><label htmlFor="package-sales-end">Sales end (optional, local time)</label><input id="package-sales-end" type="datetime-local" value={formData.salesEndAt} min={formData.salesStartAt || undefined} onChange={(e) => setFormData({ ...formData, salesEndAt: e.target.value })} /></div>
                  </div>
                  <p className="package-dialog-hint">Blank dates mean no date restriction. Sales end stops new orders only. Existing benefits and pending PayOS orders remain valid. Eligible renewals use purchased terms regardless of current sales dates or Active status; existing renewal rules still apply.</p>
                  <div className="package-dialog-field"><label htmlFor="package-optional-services">Optional services (paid separately)</label>
                    <select id="package-optional-services" multiple value={formData.optionalServiceIds} onChange={(e) => setFormData({ ...formData, optionalServiceIds: Array.from(e.target.selectedOptions, (option) => option.value) })}>
                      {serviceCatalog.filter((item) => item.isActive || formData.optionalServiceIds.includes(String(item._id))).map((item) => <option key={item._id} value={item._id}>{item.name}{item.isActive ? '' : ' (inactive)'}</option>)}
                      {formData.optionalServiceIds.filter((id) => !serviceCatalog.some((item) => String(item._id) === id)).map((id) => <option key={id} value={id}>Existing service {id}</option>)}
                    </select>
                    {serviceCatalogError && <p role="alert">{serviceCatalogError}</p>}
                    <p className="package-dialog-hint">Select real catalog services only. These services use the existing booking flow and are charged separately. No free-service quota is included.</p>
                  </div>
                  <PackageTermsSummary terms={formData} />
                  <p className="package-dialog-hint">Active names must be unique. Different Monthly configurations are allowed; exact active configurations are rejected.</p>
                  </div>
                  <div className="package-dialog-settings">
                  <div className="package-dialog-grid">
                    <div className="package-dialog-field">
                      <label htmlFor="package-slots">Max spaces per purchase <span aria-hidden="true">*</span></label>
                      <input id="package-slots" name="maxSlots" type="number" inputMode="numeric" required min="1" max="10" step="1" aria-describedby="package-slots-hint"
                        value={formData.maxSlots} onChange={(e) => setFormData({ ...formData, maxSlots: Number(e.target.value) })} />
                      <p id="package-slots-hint" className="package-dialog-hint">1-10 spaces per purchase; no global sales quantity limit.</p>
                    </div>
                    <div className="package-dialog-field">
                      <label htmlFor="package-renewal-window">Renewal Window (days) <span aria-hidden="true">*</span></label>
                      <input id="package-renewal-window" name="renewalWindowDays" type="number" inputMode="numeric" required min="1" max="60" step="1" aria-describedby="package-renewal-hint"
                        value={formData.renewalWindowDays} onChange={(e) => setFormData({ ...formData, renewalWindowDays: Number(e.target.value) })} />
                      <p id="package-renewal-hint" className="package-dialog-hint">1-60 days</p>
                    </div>
                  </div>
                  <div className="package-dialog-toggles">
                  <label className="package-dialog-toggle">
                    <input type="checkbox" name="isActive" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
                    <span className="package-dialog-switch" aria-hidden="true" />
                    <span>Active Package (off stops new purchases; existing benefits remain)</span>
                  </label>
                  <label className="package-dialog-toggle">
                    <input type="checkbox" name="isRenewable" checked={formData.isRenewable} onChange={(e) => setFormData({ ...formData, isRenewable: e.target.checked })} />
                    <span className="package-dialog-switch" aria-hidden="true" />
                    <span>Allow Renewal</span>
                  </label>
                  </div>
                  </div>
                  </>}
                </fieldset>
                </div>
                <footer className="package-dialog-footer">
                  <button type="button" onClick={() => setShowModal(false)} className="package-dialog-cancel">Cancel</button>
                  {!viewOnly && <button type="submit" disabled={saving} className="package-dialog-submit">{saving ? 'Saving...' : editingPackage ? 'Save Package' : 'Create Package'}</button>}
                </footer>
              </form>
            </DialogPanel>
          </div>
        </Dialog>
      </div>

      <ConfirmModal 
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, packageId: null })}
        onConfirm={executeDelete}
        title="Delete Package"
        message="Permanently delete this package? Deletion is allowed only if there are no purchases, payments, entitlements or historical references. To stop new purchases while preserving the package, edit it and turn off Active Package."
        confirmText="Delete permanently"
        cancelText="Cancel"
        isDestructive={true}
      />
    </div>
  );
}
