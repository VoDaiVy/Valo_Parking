import { useEffect, useMemo, useState } from 'react';
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
import AdminSelect from '../../components/Admin/AdminSelect';
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

const KNOWN_TYPES = ['hourly', 'monthly', 'yearly'];

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

function SummaryItem({ icon: Icon, label, value, support, tone = 'text-yellow-300' }) {
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
    <div className="relative min-h-[calc(100vh-70px)] overflow-hidden bg-[#050505] px-4 py-6 sm:px-6 md:px-8">
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
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-20 rounded-2xl border border-white/10 bg-white/[0.04]" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PackageRow({ pkg, isAdmin, onEdit, onDelete, index }) {
  const meta = getTypeMeta(pkg.type);
  const Icon = meta.Icon;
  const isActive = Boolean(pkg.isActive);

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#111111]/90 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#151515] motion-reduce:transform-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${meta.rowAccent} opacity-70 transition group-hover:opacity-100`} />
      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px_auto] md:items-center md:px-5">
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
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const packageState = getOperationalViewState({ loading, error: loadError });

  const [formData, setFormData] = useState({
    name: '',
    type: 'hourly',
    price: '',
    description: '',
    isActive: true,
  });

  let isAdmin = false;
  try {
    const user = JSON.parse(sessionStorage.getItem('valo_user'));
    if (user && user.role === 'admin') isAdmin = true;
  } catch {
    isAdmin = false;
  }

  const fetchPackages = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPackages(data.data);
        setLoadError('');
      } else {
        setPackages([]);
        setLoadError(data?.message || 'Failed to load ticket packages');
      }
    } catch (err) {
      console.error(err);
      setPackages([]);
      setLoadError('Failed to load ticket packages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchPackages();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const openModal = (pkg = null) => {
    setError('');
    if (pkg) {
      setEditingPackage(pkg);
      setFormData({
        name: pkg.name,
        type: pkg.type,
        price: pkg.price,
        description: pkg.description || '',
        isActive: pkg.isActive,
      });
    } else {
      setEditingPackage(null);
      setFormData({
        name: '',
        type: 'hourly',
        price: '',
        description: '',
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...formData, price: Number(formData.price) };
      const config = {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      };

      if (editingPackage) {
        await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages/${editingPackage._id}`, {
          method: 'PUT',
          ...config,
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages`, {
          method: 'POST',
          ...config,
          body: JSON.stringify(payload),
        });
      }

      setShowModal(false);
      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Failed to save ticket package');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this package?')) return;
    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL}/ticket-packages/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      fetchPackages();
    } catch (err) {
      console.error(err);
      setError('Failed to delete package');
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

  if (loading && packages.length === 0) {
    return <LoadingSkeleton isAdmin={isAdmin} />;
  }

  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-auto bg-[#050505] px-4 py-6 text-white sm:px-6 md:px-8">
      <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-yellow-400/[0.06] blur-3xl" />
      <div className="pointer-events-none absolute right-24 top-16 h-px w-96 max-w-[70vw] bg-gradient-to-r from-transparent via-yellow-300/20 to-transparent" />

      <div className="relative mx-auto max-w-7xl">
        <header className="mb-8 flex animate-[fadeIn_420ms_ease-out_both] flex-col justify-between gap-4 motion-reduce:animate-none md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <Tag size={12} /> Packages
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Ticket Packages</h1>
            <p className="mt-2 text-sm font-medium text-slate-400">Manage parking rates and ticket packages.</p>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => openModal()}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-500 px-6 text-sm font-black text-[#111111] shadow-lg shadow-yellow-500/20 transition hover:-translate-y-0.5 hover:shadow-yellow-500/30 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-yellow-200/80 motion-reduce:transform-none motion-reduce:transition-none"
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

        <section className="mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/20 sm:grid-cols-3">
          <SummaryItem
            icon={Package}
            label="Total Packages"
            value={getOperationalValue(packageState, summary.total.toLocaleString('vi-VN'))}
            support={packageState.isAvailable ? 'Loaded packages' : 'Data unavailable'}
          />
          <SummaryItem
            icon={CheckCircle2}
            label="Active Packages"
            value={getOperationalValue(packageState, summary.active.toLocaleString('vi-VN'))}
            support={packageState.isAvailable ? 'Enabled and visible' : 'Data unavailable'}
            tone="text-emerald-300"
          />
          <SummaryItem
            icon={CalendarClock}
            label="Last Updated"
            value={getOperationalValue(packageState, summary.latestUpdated.split(' ')[0])}
            support={packageState.isAvailable ? (summary.latestUpdated.split(' ').slice(1).join(' ') || 'No timestamp') : 'Data unavailable'}
            tone="text-blue-300"
          />
        </section>

        <section className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
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

        <section className="mb-6">
          <div className={`hidden px-5 pb-3 pt-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 md:grid ${isAdmin ? 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px_auto]' : 'md:grid-cols-[minmax(240px,1.5fr)_120px_minmax(135px,0.8fr)_120px_150px]'}`}>
            <span>Package</span>
            <span>Type</span>
            <span>Price</span>
            <span>Status</span>
            <span>Last Updated</span>
            {isAdmin && <span className="text-right">Actions</span>}
          </div>

          {loadError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">Ticket package data unavailable</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{loadError}</p>
            </div>
          ) : filteredPackages.length > 0 ? (
            <div className="space-y-3">
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

        <aside className="mb-4 flex items-start gap-3 rounded-2xl border border-yellow-300/15 bg-gradient-to-r from-yellow-300/[0.08] via-white/[0.025] to-transparent px-4 py-4 text-sm">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-yellow-300/20 bg-yellow-300/10 text-yellow-300">
            <Info size={17} />
          </div>
          <div>
            <p className="font-black text-yellow-200">Package management</p>
            <p className="mt-1 font-medium text-slate-400">Review package changes carefully before saving.</p>
          </div>
        </aside>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#171717] p-6 shadow-2xl md:p-8">
              <h2 className="mb-6 text-2xl font-black text-white">{editingPackage ? 'Edit Package' : 'Create Package'}</h2>

              {error && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-semibold text-red-400">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
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
                        { value: 'monthly', label: 'Monthly' },
                        { value: 'yearly', label: 'Yearly' },
                      ]}
                      icon={Tag}
                      className="w-full"
                      ariaLabel="Select ticket package type"
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

                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="min-h-[80px] w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-gold focus:ring-1 focus:ring-gold"
                    placeholder="Optional description"
                  />
                </div>

                <div className="flex items-center gap-3 py-2">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    />
                    <div className="peer h-6 w-11 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-gold peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
                    <span className="ml-3 text-sm font-bold text-white">Active Package</span>
                  </label>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 rounded-xl bg-white/5 px-4 py-3 font-bold text-gray-400 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-gold px-4 py-3 font-bold text-[#0B0E17] shadow-lg shadow-gold/20 transition hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-yellow-200/80"
                  >
                    Save Package
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
