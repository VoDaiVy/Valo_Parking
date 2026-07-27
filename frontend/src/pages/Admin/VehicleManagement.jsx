import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Upload, RefreshCw, CheckCircle2, AlertCircle,
  Car, Loader2, X, Eye, Palette, Check, Zap, Image,
  Clock, Box, Search, SlidersHorizontal, Building2, Cuboid, MoreVertical,
} from 'lucide-react';
import { apiFetch, API_BASE } from '../../services/api';
import CarViewer from '../../components/CarViewer';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';
import AdminSelect from '../../components/Admin/AdminSelect';
import ConfirmModal from '../../components/Admin/ConfirmModal';

// ── helpers ────────────────────────────────────────────────────────────────
const authHeader = () => {
  const t = localStorage.getItem('accessToken');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const normalizeSlug = (s = '') =>
  s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const previewPublicId = (brand, model) =>
  `vehicles/${normalizeSlug(brand) || '…'}/${normalizeSlug(model || 'default') || '…'}`;

const parseModelPublicId = (publicId = '') => {
  const [, brand = 'unknown', model = 'default'] = publicId.split('/');
  return {
    brand,
    model,
    brandLabel: brand.replace(/-/g, ' '),
    modelLabel: model.replace(/-/g, ' '),
  };
};

const formatBytes = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024).toFixed(0)} KB`;
};

const formatDate = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('vi-VN');
};

const scrollbarClass =
  '[scrollbar-color:rgba(255,255,255,.18)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-button]:w-0 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 hover:[&::-webkit-scrollbar-thumb]:bg-yellow-400/40';

/** Find the 3D model that matches vehicle brand+model. Prefer exact match and fallback to default. */
const findMatchingModel = (models, brand, vehicleModel) => {
  const brandSlug = normalizeSlug(brand);
  const modelSlug = normalizeSlug(vehicleModel);
  const exactKey = `vehicles/${brandSlug}/${modelSlug}`;
  const defaultKey = `vehicles/${brandSlug}/default`;
  return (
    models.find((m) => m.publicId === exactKey) ||
    models.find((m) => m.publicId === defaultKey) ||
    null
  );
};

// ── API helpers ────────────────────────────────────────────────────────────
const fetchModelsAPI = () =>
  apiFetch('/admin/vehicles/models', { headers: authHeader() });

const fetchApprovedVehiclesAPI = () =>
  apiFetch('/admin/vehicles/approved', { headers: authHeader() });

const uploadModelAPI = async (brand, vehicleModel, file) => {
  const fd = new FormData();
  fd.append('brand', brand);
  fd.append('model', vehicleModel || 'default');
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/admin/vehicles/upload-model`, {
    method: 'POST',
    headers: authHeader(),
    body: fd,
  });
  const data = await res.json();
  return { ok: res.ok, data };
};

const deleteModelAPI = (brand, vehicleModel) =>
  apiFetch('/admin/vehicles/upload-model', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ brand, model: vehicleModel }),
  });

const syncModelsAPI = () =>
  apiFetch('/admin/vehicles/sync-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });

// ── 3D Preview Modal ───────────────────────────────────────────────────────
function PreviewModal({ model, onClose }) {
  const [color, setColor] = useState('#c0392b');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-gray-950">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p className="font-bold text-white text-sm">{model.publicId}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {(model.bytes / 1024).toFixed(0)} KB &nbsp;·&nbsp;
              {new Date(model.createdAt).toLocaleDateString('vi-VN')}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition">
            <X size={18} />
          </button>
        </div>
        <div className="relative h-72 sm:h-80 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
          <CarViewer modelUrl={model.url} carColor={color} height={320} />
        </div>
        <div className="flex items-center gap-3 px-5 py-4 border-t border-white/10 bg-gray-950">
          <Palette size={15} className="text-gray-400 shrink-0" />
          <span className="text-xs text-gray-400 shrink-0">Paint color test:</span>
          <div className="flex items-center gap-2 flex-wrap">
            {['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#1a1a1a'].map((c) => (
              <button key={c} onClick={() => setColor(c)} title={c}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  color === c ? 'border-white scale-110' : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-6 h-6 rounded-full cursor-pointer border border-white/20 bg-transparent p-0"
              title="Color options"
            />
          </div>
          <span className="ml-auto font-mono text-xs text-gray-500">{color}</span>
        </div>
      </div>
    </div>
  );
}

// ── Pending vehicle card ───────────────────────────────────────────────────
function PendingCard({ vehicle, models, processing, onApprove, onReject, onPreviewImage, onPreview3D }) {
  const matched = findMatchingModel(models, vehicle.brand, vehicle.model);
  const [localFile, setLocalFile] = useState(null);
  const fileRef = useRef();
  const typeLabel = { car: 'Car', electric_car: 'Electric car' }[vehicle.vehicleType] || vehicle.vehicleType;

  return (
    <div className="group relative grid gap-4 border-t border-white/[0.08] py-4 pl-4 transition hover:bg-yellow-400/[0.025] md:grid-cols-[96px_minmax(220px,1.2fr)_minmax(180px,0.8fr)_minmax(240px,1fr)_auto] md:items-center">
      <span className="absolute left-0 top-4 h-[calc(100%-32px)] w-0.5 origin-top scale-y-0 rounded-full bg-yellow-300 transition group-hover:scale-y-100" />
      <button
        type="button"
        className="relative h-24 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] md:h-16"
        onClick={() => vehicle.registrationCardImage && onPreviewImage(vehicle.registrationCardImage)}
      >
        {vehicle.registrationCardImage ? (
          <>
            <img src={vehicle.registrationCardImage} alt="Vehicle registration card" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
              <Image size={18} />
            </span>
          </>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1 text-[10px] font-bold text-slate-600">
            <Image size={18} />
            No image
          </span>
        )}
      </button>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-black text-white">
            {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'No name yet'}
          </h3>
          <span className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-orange-300">
            Pending
          </span>
        </div>
        <p className="mt-1 font-mono text-sm font-black tracking-[0.14em] text-blue-100/80">
          {formatLicensePlateDisplay(vehicle.licensePlateDisplay || vehicle.licensePlate)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1">
            {vehicle.vehicleType === 'electric_car' ? <Zap size={12} /> : <Car size={12} />}
            {typeLabel}
          </span>
          {vehicle.hexColor && (
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: vehicle.hexColor }} />
              {vehicle.hexColor}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Owner</p>
        <p className="mt-1 truncate font-bold text-slate-300">{vehicle.owner?.name || vehicle.owner?.email || '—'}</p>
        <p className="mt-1 truncate text-xs font-semibold text-slate-600">{vehicle.owner?.email || 'No email'}</p>
      </div>

      <div className="min-w-0">
        {matched ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-emerald-300">3D model ready</p>
              <code className="block truncate text-[10px] font-semibold text-slate-500">{matched.publicId}</code>
            </div>
            <button
              type="button"
              onClick={() => onPreview3D(matched)}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-yellow-300"
              title="Preview 3D"
            >
              <Eye size={14} />
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-2 transition ${
              localFile
                ? 'border-yellow-400/45 bg-yellow-400/5'
                : 'border-white/10 bg-white/[0.02] hover:border-yellow-400/40 hover:bg-yellow-400/5'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".glb"
              className="hidden"
              onChange={(e) => setLocalFile(e.target.files[0] ?? null)}
            />
            <Upload size={16} className={localFile ? 'shrink-0 text-yellow-300' : 'shrink-0 text-slate-500'} />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-xs font-black ${localFile ? 'text-yellow-300' : 'text-slate-400'}`}>
                {localFile ? localFile.name : 'Attach optional .glb'}
              </p>
              <p className="text-[10px] font-semibold text-slate-600">
                {localFile ? `${formatBytes(localFile.size)} · upload on approval` : 'No matching model yet'}
              </p>
            </div>
            {localFile && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLocalFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="rounded p-1 text-slate-500 transition hover:text-red-300"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        <button
          onClick={() => onApprove(vehicle, matched?.url ?? null, localFile)}
          disabled={processing}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-sm font-black text-white shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
        <button
          onClick={() => onReject(vehicle._id)}
          disabled={processing}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-red-500/25 px-3 text-sm font-black text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
        >
          <X size={14} />
          Reject
        </button>
      </div>
    </div>
  );
}

function ApprovedVehicleCard({ vehicle, models, onPreviewImage, onPreview3D }) {
  const matched = findMatchingModel(models, vehicle.brand, vehicle.model);
  const typeLabel = { car: 'Car', electric_car: 'Electric car' }[vehicle.vehicleType] || vehicle.vehicleType;
  const approvedDate = formatDate(vehicle.updatedAt || vehicle.createdAt);

  return (
    <div className="group relative grid gap-4 border-t border-white/[0.08] py-4 pl-4 transition hover:bg-emerald-400/[0.025] md:grid-cols-[96px_minmax(220px,1.1fr)_minmax(180px,0.8fr)_minmax(220px,0.9fr)_minmax(180px,0.8fr)] md:items-center">
      <span className="absolute left-0 top-4 h-[calc(100%-32px)] w-0.5 origin-top scale-y-0 rounded-full bg-emerald-300 transition group-hover:scale-y-100" />
      <button
        type="button"
        className="relative h-24 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] md:h-16"
        onClick={() => vehicle.registrationCardImage && onPreviewImage(vehicle.registrationCardImage)}
      >
        {vehicle.registrationCardImage ? (
          <>
            <img src={vehicle.registrationCardImage} alt="Vehicle registration card" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
              <Image size={18} />
            </span>
          </>
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1 text-[10px] font-bold text-slate-600">
            <Image size={18} />
            No image
          </span>
        )}
      </button>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-black text-white">
            {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'No name yet'}
          </h3>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-300">
            Approved
          </span>
        </div>
        <p className="mt-1 font-mono text-sm font-black tracking-[0.14em] text-blue-100/80">
          {formatLicensePlateDisplay(vehicle.licensePlateDisplay || vehicle.licensePlate)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1">
            {vehicle.vehicleType === 'electric_car' ? <Zap size={12} /> : <Car size={12} />}
            {typeLabel}
          </span>
          {vehicle.hexColor && (
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: vehicle.hexColor }} />
              {vehicle.hexColor}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 text-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Owner</p>
        <p className="mt-1 truncate font-bold text-slate-300">{vehicle.owner?.name || vehicle.owner?.email || '—'}</p>
        <p className="mt-1 truncate text-xs font-semibold text-slate-600">{vehicle.owner?.email || 'No email'}</p>
      </div>

      <div className="min-w-0">
        {vehicle.modelUrl || matched ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-emerald-300">3D model linked</p>
              <code className="block truncate text-[10px] font-semibold text-slate-500">{matched?.publicId || 'Custom URL'}</code>
            </div>
            {matched && (
              <button
                type="button"
                onClick={() => onPreview3D(matched)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-yellow-300"
                title="Preview 3D"
              >
                <Eye size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
            <p className="text-xs font-black text-slate-400">No 3D model</p>
            <p className="mt-0.5 text-[10px] font-semibold text-slate-600">Upload a matching model to link it</p>
          </div>
        )}
      </div>

      <div className="text-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Approved</p>
        <p className="mt-1 font-bold text-slate-300">{approvedDate}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
const inputCls =
  'w-full rounded-xl border border-white/10 bg-black ' +
  'px-3.5 py-2.5 text-sm text-white placeholder-gray-500 ' +
  'focus:outline-none focus:ring-1 focus:ring-yellow-500/50 transition shadow-inner';

function SummaryStrip({ metrics }) {
  return (
    <section className="border-y border-white/[0.08]">
      <div className="grid grid-cols-1 divide-y divide-white/[0.08] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="flex items-center gap-4 px-0 py-5 sm:px-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-yellow-400/20 bg-yellow-400/10 text-yellow-300">
                <Icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-200/55">{metric.label}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="font-mono text-3xl font-black text-white">{metric.value}</p>
                  <p className="truncate text-xs font-bold text-blue-200/50">{metric.note}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SegmentControl({ tab, setTab, pendingCount, approvedCount, modelCount }) {
  const options = [
    { id: 'pending', label: 'Pending', count: pendingCount, icon: Clock },
    { id: 'approved', label: 'Approved', count: approvedCount, icon: CheckCircle2 },
    { id: 'models', label: '3D Models', count: modelCount, icon: Box },
  ];

  return (
    <div className="inline-grid rounded-[16px] border border-white/[0.08] bg-[#111111]/70 p-1 sm:grid-cols-3">
      {options.map((option) => {
        const Icon = option.icon;
        const active = tab === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setTab(option.id)}
            className={`relative flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-black transition ${
              active ? 'text-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            {active && (
              <motion.span
                layoutId="vehicle-segment-pill"
                className="absolute inset-0 rounded-[12px] bg-yellow-300"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon size={15} />
              {option.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-black/10' : 'bg-white/5'}`}>
                {option.count}
              </span>
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}

function EmptyState({ title, subtitle, icon: Icon, action, secondaryAction }) {
  return (
    <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden border-y border-white/[0.08] px-5 py-10 text-center">
      <div className="pointer-events-none absolute h-64 w-64 rounded-full bg-yellow-400/10 blur-[90px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(rgba(250,204,21,.75)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="relative">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] border border-yellow-400/15 bg-[#111111]/90 text-yellow-300 shadow-2xl shadow-yellow-400/5">
          <Icon size={34} />
        </div>
        <h3 className="text-2xl font-black text-white">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-blue-200/55">{subtitle}</p>
        {(action || secondaryAction) && (
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {action}
            {secondaryAction}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelGalleryCard({ model, onPreview, onDelete }) {
  const parsed = parseModelPublicId(model.publicId);
  return (
    <motion.article
      whileHover={{ y: -4, scale: 1.02 }}
      className="group overflow-hidden border border-white/[0.08] bg-[#101010] transition hover:border-yellow-400/25 hover:shadow-2xl hover:shadow-yellow-400/5"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(234,179,8,.16),transparent_58%),#080808]">
        <Cuboid size={48} className="text-yellow-300/80" />
        <button
          type="button"
          onClick={() => onPreview(model)}
          className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100"
        >
          <span className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 text-xs font-black text-white">
            <Eye size={14} />
            Preview
          </span>
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black capitalize text-white">{parsed.brandLabel}</h3>
            <p className="mt-1 truncate font-mono text-xs font-semibold text-blue-200/50">{parsed.modelLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(model.publicId)}
            className="rounded-lg p-1.5 text-slate-600 transition hover:bg-red-500/10 hover:text-red-300"
            title="Delete model"
          >
            <MoreVertical size={16} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3 text-[11px] font-bold text-slate-500">
          <span>{formatBytes(model.bytes)}</span>
          <span className="text-right">{formatDate(model.createdAt)}</span>
        </div>
      </div>
    </motion.article>
  );
}

export default function VehicleManagement() {
  const [tab, setTab] = useState('pending');
  const reduceMotion = useReducedMotion();

  // ── Shared state ──
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [preview3D, setPreview3D] = useState(null);

  // ── Pending tab state ──
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [processing, setProcessing] = useState({});
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, id: null });
  const [previewImg, setPreviewImg] = useState(null);
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingStatusFilter, setPendingStatusFilter] = useState('all');
  const [pendingBrandFilter, setPendingBrandFilter] = useState('all');

  // ── Approved tab state ──
  const [approved, setApproved] = useState([]);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [approvedSearch, setApprovedSearch] = useState('');
  const [approvedBrandFilter, setApprovedBrandFilter] = useState('all');

  // ── Models tab state ──
  const [brand, setBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [modelSearch, setModelSearch] = useState('');
  const [modelBrandFilter, setModelBrandFilter] = useState('all');
  const fileRef = useRef();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadModels = async () => {
    setModelsLoading(true);
    const { ok, data } = await fetchModelsAPI();
    if (ok) setModels(data.data || []);
    setModelsLoading(false);
  };

  const loadPending = async () => {
    setPendingLoading(true);
    const res = await apiFetch('/admin/vehicles/pending', { headers: authHeader() });
    setPendingLoading(false);
    if (res.ok) setPending(res.data?.data || []);
  };

  const loadApproved = async () => {
    setApprovedLoading(true);
    const res = await fetchApprovedVehiclesAPI();
    setApprovedLoading(false);
    if (res.ok) setApproved(res.data?.data || []);
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadModels();
      loadPending();
      loadApproved();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  // ── Approve handler ────────────────────────────────────────────────────────
  const handleApprove = async (vehicle, existingModelUrl, localFile) => {
    setProcessing((p) => ({ ...p, [vehicle._id]: true }));

    let finalModelUrl = existingModelUrl;

    // If admin attaches a new file -> upload first
    if (localFile) {
      const { ok, data } = await uploadModelAPI(vehicle.brand, vehicle.model, localFile);
      if (ok) {
        finalModelUrl = data.data?.url ?? existingModelUrl;
        showToast(`Upload model: ${data.data?.publicId}`);
        await loadModels(); // refresh the model list
      } else {
        showToast(data.message || 'Model upload failed', 'error');
        setProcessing((p) => ({ ...p, [vehicle._id]: false }));
        return;
      }
    }

    const res = await apiFetch(`/admin/vehicles/${vehicle._id}/approve`, {
      method: 'PATCH',
      headers: authHeader(),
      body: JSON.stringify({ modelUrl: finalModelUrl || undefined }),
    });
    setProcessing((p) => ({ ...p, [vehicle._id]: false }));
    if (res.ok) {
      showToast('Vehicle approved ✓');
      setPending((v) => v.filter((x) => x._id !== vehicle._id));
      await loadApproved();
    } else {
      showToast(res.data?.message || 'Approval failed', 'error');
    }
  };

  const handleReject = (id) => {
    setDeleteModal({ isOpen: true, id });
  };

  const executeReject = async () => {
    const { id } = deleteModal;
    if (!id) return;
    setProcessing((p) => ({ ...p, [id]: true }));
    const res = await apiFetch(`/admin/vehicles/${id}/reject`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    setProcessing((p) => ({ ...p, [id]: false }));
    if (res.ok) {
      showToast('Vehicle rejected');
      setPending((v) => v.filter((x) => x._id !== id));
    } else {
      showToast(res.data?.message || 'Action failed', 'error');
    }
    setDeleteModal({ isOpen: false, id: null });
  };

  // ── Upload model handler ───────────────────────────────────────────────────
  const handleUpload = async (e) => {
    e.preventDefault();
    if (!brand.trim()) return showToast('Enter Brand first', 'error');
    if (!uploadFile) return showToast('Choose a .glb file first', 'error');
    setUploading(true);
    const { ok, data } = await uploadModelAPI(brand, vehicleModel, uploadFile);
    setUploading(false);
    if (ok) {
      const synced = data.data?.vehiclesSynced ?? 0;
      showToast(`Uploaded: ${data.data?.publicId}${synced ? ` · updated ${synced} vehicles` : ''}`);
      setBrand(''); setVehicleModel(''); setUploadFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await loadModels();
      await loadApproved();
    } else {
      showToast(data.message || 'Upload failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const parts = deleteTarget.split('/');
    const { ok, data } = await deleteModelAPI(parts[1] ?? '', parts[2] ?? 'default');
    setDeleteTarget(null);
    if (ok) {
      const synced = data?.data?.vehiclesSynced ?? 0;
      showToast(`Model deleted${synced ? ` · removed 3D from ${synced} vehicles` : ''}`);
      await loadModels();
      await loadApproved();
    } else {
      showToast(data?.message || 'Delete failed', 'error');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const { ok, data } = await syncModelsAPI();
    setSyncing(false);
    if (ok) {
      showToast(`Sync complete · ${data.data?.updated ?? 0} vehicles updated`);
      await loadApproved();
    } else {
      showToast(data?.message || 'Sync failed', 'error');
    }
  };

  const pendingBrands = useMemo(
    () => [...new Set(pending.map((item) => item.brand).filter(Boolean))].sort(),
    [pending]
  );
  const approvedBrands = useMemo(
    () => [...new Set(approved.map((item) => item.brand).filter(Boolean))].sort(),
    [approved]
  );
  const modelBrands = useMemo(
    () => [...new Set(models.map((item) => parseModelPublicId(item.publicId).brand).filter(Boolean))].sort(),
    [models]
  );
  const manufacturerCount = useMemo(
    () => new Set([
      ...pending.map((item) => normalizeSlug(item.brand)).filter(Boolean),
      ...approved.map((item) => normalizeSlug(item.brand)).filter(Boolean),
      ...models.map((item) => parseModelPublicId(item.publicId).brand).filter(Boolean),
    ]).size,
    [approved, models, pending]
  );
  const filteredPending = useMemo(() => {
    const query = pendingSearch.trim().toLowerCase();
    return pending.filter((vehicle) => {
      const haystack = [
        vehicle.brand,
        vehicle.model,
        vehicle.licensePlate,
        vehicle.licensePlateDisplay,
        vehicle.owner?.name,
        vehicle.owner?.email,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesBrand = pendingBrandFilter === 'all' || vehicle.brand === pendingBrandFilter;
      const matchesStatus = pendingStatusFilter === 'all' || pendingStatusFilter === 'pending';
      return matchesSearch && matchesBrand && matchesStatus;
    });
  }, [pending, pendingBrandFilter, pendingSearch, pendingStatusFilter]);
  const filteredApproved = useMemo(() => {
    const query = approvedSearch.trim().toLowerCase();
    return approved.filter((vehicle) => {
      const haystack = [
        vehicle.brand,
        vehicle.model,
        vehicle.licensePlate,
        vehicle.licensePlateDisplay,
        vehicle.owner?.name,
        vehicle.owner?.email,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesBrand = approvedBrandFilter === 'all' || vehicle.brand === approvedBrandFilter;
      return matchesSearch && matchesBrand;
    });
  }, [approved, approvedBrandFilter, approvedSearch]);
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter((model) => {
      const parsed = parseModelPublicId(model.publicId);
      const haystack = [model.publicId, parsed.brandLabel, parsed.modelLabel].join(' ').toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesBrand = modelBrandFilter === 'all' || parsed.brand === modelBrandFilter;
      return matchesSearch && matchesBrand;
    });
  }, [modelBrandFilter, modelSearch, models]);
  const summaryMetrics = [
    { label: 'Pending', value: pending.length, note: 'Awaiting approval', icon: Clock },
    { label: 'Approved', value: approved.length, note: 'Verified vehicles', icon: CheckCircle2 },
    { label: '3D Models', value: models.length, note: 'Uploaded assets', icon: Box },
    { label: 'Manufacturers', value: manufacturerCount, note: 'From visible data', icon: Building2 },
  ];
  const motionProps = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.36, ease: 'easeOut' },
      };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`relative min-h-[calc(100vh-70px)] overflow-auto bg-[#090909] px-4 py-6 text-white sm:px-6 lg:px-8 ${scrollbarClass}`}>
      <div className="pointer-events-none absolute right-10 top-0 h-72 w-72 rounded-full bg-yellow-400/10 blur-[115px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,.62)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.62)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative mx-auto max-w-[1500px]">
        <motion.header
          {...motionProps}
          className="mb-7 flex flex-col gap-5 border-b border-white/[0.08] pb-7 lg:flex-row lg:items-end lg:justify-between"
        >
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-yellow-300">
              <Car size={13} />
              Vehicles
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Vehicles &amp; 3D Models
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-200/60 sm:text-[15px]">
              Approve vehicle registrations, manage GLB model assets, and sync previews without leaving the workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { loadPending(); loadApproved(); loadModels(); }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200"
          >
            <RefreshCw size={15} className={pendingLoading || approvedLoading || modelsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </motion.header>

        <motion.div {...motionProps} transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.06 }}>
          <SummaryStrip metrics={summaryMetrics} />
        </motion.div>

        <motion.div
          {...motionProps}
          transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.1 }}
          className="my-6 flex flex-col gap-4 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentControl tab={tab} setTab={setTab} pendingCount={pending.length} approvedCount={approved.length} modelCount={models.length} />
          {tab === 'pending' ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_190px_auto]">
              <label className="relative">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  placeholder="Search vehicle, plate, owner..."
                  className="h-12 w-full rounded-[14px] border border-white/[0.08] bg-[#111111] pl-11 pr-4 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-400/40"
                />
              </label>
              <AdminSelect
                value={pendingStatusFilter}
                onChange={setPendingStatusFilter}
                options={[
                  { value: 'all', label: 'All Status' },
                  { value: 'pending', label: 'Pending' },
                ]}
                icon={SlidersHorizontal}
                ariaLabel="Filter vehicles by status"
              />
              <AdminSelect
                value={pendingBrandFilter}
                onChange={setPendingBrandFilter}
                options={[
                  { value: 'all', label: 'All Manufacturers' },
                  ...pendingBrands.map((item) => ({ value: item, label: item })),
                ]}
                icon={Building2}
                ariaLabel="Filter vehicles by manufacturer"
              />
              <button type="button" onClick={loadPending} className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200">
                <RefreshCw size={15} className={pendingLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          ) : tab === 'approved' ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_190px_auto]">
              <label className="relative">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={approvedSearch}
                  onChange={(e) => setApprovedSearch(e.target.value)}
                  placeholder="Search approved vehicle, plate, owner..."
                  className="h-12 w-full rounded-[14px] border border-white/[0.08] bg-[#111111] pl-11 pr-4 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-400/40"
                />
              </label>
              <AdminSelect
                value={approvedBrandFilter}
                onChange={setApprovedBrandFilter}
                options={[
                  { value: 'all', label: 'All Manufacturers' },
                  ...approvedBrands.map((item) => ({ value: item, label: item })),
                ]}
                icon={Building2}
                ariaLabel="Filter approved vehicles by manufacturer"
              />
              <button type="button" onClick={loadApproved} className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200">
                <RefreshCw size={15} className={approvedLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_190px_auto_auto]">
              <label className="relative">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search model or public id..."
                  className="h-12 w-full rounded-[14px] border border-white/[0.08] bg-[#111111] pl-11 pr-4 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-yellow-400/40"
                />
              </label>
              <AdminSelect
                value={modelBrandFilter}
                onChange={setModelBrandFilter}
                options={[
                  { value: 'all', label: 'All Brands' },
                  ...modelBrands.map((item) => ({ value: item, label: item })),
                ]}
                icon={Building2}
                ariaLabel="Filter models by brand"
              />
              <button type="button" onClick={handleSync} disabled={syncing} className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-yellow-400/25 bg-yellow-400/10 px-4 text-sm font-black text-yellow-200 transition hover:bg-yellow-400/15 disabled:opacity-50">
                {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Sync
              </button>
              <button type="button" onClick={loadModels} className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200">
                <RefreshCw size={15} className={modelsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          )}
        </motion.div>

        {tab === 'pending' && (
          <motion.section {...motionProps} transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.14 }}>
            {pendingLoading ? (
              <div className="flex min-h-[320px] items-center justify-center border-y border-white/[0.08]">
                <Loader2 size={28} className="animate-spin text-yellow-300" />
              </div>
            ) : pending.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All vehicles approved"
                subtitle="No pending approval requests are waiting in the current response."
                action={(
                  <button type="button" onClick={() => setTab('models')} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:text-yellow-200">
                    <Box size={15} />
                    View 3D Models
                  </button>
                )}
                secondaryAction={(
                  <button type="button" onClick={loadPending} className="inline-flex h-11 items-center gap-2 rounded-full bg-yellow-300 px-4 text-sm font-black text-black transition hover:bg-yellow-200">
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                )}
              />
            ) : filteredPending.length === 0 ? (
              <EmptyState icon={Search} title="No vehicles match current filters" subtitle="Try another plate, owner, or manufacturer filter." />
            ) : (
              <div>
                <div className="hidden border-b border-white/[0.08] px-4 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:grid md:grid-cols-[96px_minmax(220px,1.2fr)_minmax(180px,0.8fr)_minmax(240px,1fr)_auto]">
                  <span>Card</span>
                  <span>Vehicle</span>
                  <span>Owner</span>
                  <span>3D Model</span>
                  <span className="text-right">Actions</span>
                </div>
                {filteredPending.map((v) => (
                  <PendingCard
                    key={v._id}
                    vehicle={v}
                    models={models}
                    processing={!!processing[v._id]}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onPreviewImage={setPreviewImg}
                    onPreview3D={setPreview3D}
                  />
                ))}
              </div>
            )}
          </motion.section>
        )}

        {tab === 'approved' && (
          <motion.section {...motionProps} transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.14 }}>
            {approvedLoading ? (
              <div className="flex min-h-[320px] items-center justify-center border-y border-white/[0.08]">
                <Loader2 size={28} className="animate-spin text-yellow-300" />
              </div>
            ) : approved.length === 0 ? (
              <EmptyState
                icon={Car}
                title="No approved vehicles yet"
                subtitle="Approved vehicles will appear here after registration requests are reviewed."
                action={(
                  <button type="button" onClick={() => setTab('pending')} className="inline-flex h-11 items-center gap-2 rounded-full border border-white/[0.08] px-4 text-sm font-black text-slate-300 transition hover:border-yellow-400/30 hover:text-yellow-200">
                    <Clock size={15} />
                    View Pending
                  </button>
                )}
                secondaryAction={(
                  <button type="button" onClick={loadApproved} className="inline-flex h-11 items-center gap-2 rounded-full bg-yellow-300 px-4 text-sm font-black text-black transition hover:bg-yellow-200">
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                )}
              />
            ) : filteredApproved.length === 0 ? (
              <EmptyState icon={Search} title="No approved vehicles match current filters" subtitle="Try another plate, owner, or manufacturer filter." />
            ) : (
              <div>
                <div className="hidden border-b border-white/[0.08] px-4 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 md:grid md:grid-cols-[96px_minmax(220px,1.1fr)_minmax(180px,0.8fr)_minmax(220px,0.9fr)_minmax(180px,0.8fr)]">
                  <span>Card</span>
                  <span>Vehicle</span>
                  <span>Owner</span>
                  <span>3D Model</span>
                  <span>Approved</span>
                </div>
                {filteredApproved.map((vehicle) => (
                  <ApprovedVehicleCard
                    key={vehicle._id}
                    vehicle={vehicle}
                    models={models}
                    onPreviewImage={setPreviewImg}
                    onPreview3D={setPreview3D}
                  />
                ))}
              </div>
            )}
          </motion.section>
        )}

        {tab === 'models' && (
          <motion.section {...motionProps} transition={{ ...motionProps.transition, delay: reduceMotion ? 0 : 0.14 }} className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <form onSubmit={handleUpload} className="border border-white/[0.08] bg-[#101010] p-5">
              <div className="mb-5">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-yellow-300">Upload Model</p>
                <h2 className="mt-2 text-2xl font-black text-white">New GLB Asset</h2>
                <p className="mt-2 text-sm leading-6 text-blue-200/50">Use the existing upload handler and Cloudinary naming convention.</p>
              </div>
              <div className="space-y-4">
                <label>
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Brand</span>
                  <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Toyota" className={inputCls} />
                </label>
                <label>
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">Model optional</span>
                  <input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="Land Cruiser" className={inputCls} />
                </label>
                {brand && (
                  <p className="rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-xs font-semibold text-blue-200/55">
                    <code className="font-mono text-yellow-200">{previewPublicId(brand, vehicleModel)}</code>
                  </p>
                )}
                <div onClick={() => fileRef.current?.click()} className={`cursor-pointer border border-dashed px-5 py-8 text-center transition ${uploadFile ? 'border-yellow-400/45 bg-yellow-400/5' : 'border-white/[0.12] bg-black/30 hover:border-yellow-400/35 hover:bg-yellow-400/5'}`}>
                  <input ref={fileRef} type="file" accept=".glb" className="hidden" onChange={(e) => setUploadFile(e.target.files[0] ?? null)} />
                  <Upload size={30} className="mx-auto text-yellow-300" />
                  <p className="mt-3 text-sm font-black text-white">{uploadFile ? uploadFile.name : 'Drop your first GLB model here'}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{uploadFile ? formatBytes(uploadFile.size) : 'Click to choose .glb · maximum 50 MB'}</p>
                </div>
                <button type="submit" disabled={uploading || !brand || !uploadFile} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-yellow-300 text-sm font-black text-black transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-50">
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  {uploading ? 'Uploading...' : 'Upload Model'}
                </button>
              </div>
            </form>

            <div>
              <div className="mb-4 flex items-center justify-between border-b border-white/[0.08] pb-4">
                <div>
                  <h2 className="text-xl font-black text-white">Model Gallery</h2>
                  <p className="mt-1 text-sm font-semibold text-blue-200/50">{filteredModels.length} of {models.length} models</p>
                </div>
              </div>
              {modelsLoading ? (
                <div className="flex min-h-[320px] items-center justify-center border-y border-white/[0.08]">
                  <Loader2 size={28} className="animate-spin text-yellow-300" />
                </div>
              ) : models.length === 0 ? (
                <EmptyState icon={Cuboid} title="No 3D models uploaded yet" subtitle="Upload a GLB asset to start matching vehicle registrations with previews." />
              ) : filteredModels.length === 0 ? (
                <EmptyState icon={Search} title="No models match current filters" subtitle="Try another brand or public id search." />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {filteredModels.map((model) => (
                    <ModelGalleryCard key={model.publicId} model={model} onPreview={setPreview3D} onDelete={setDeleteTarget} />
                  ))}
                </div>
              )}
            </div>
          </motion.section>
        )}

      {/* ── Shared modals ── */}

      {/* 3D Preview Modal */}
      {preview3D && <PreviewModal model={preview3D} onClose={() => setPreview3D(null)} />}

      {/* Image lightbox */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImg(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={previewImg} alt="Vehicle registration card" className="w-full rounded-2xl shadow-2xl" />
            <button onClick={() => setPreviewImg(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Confirm delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[#171717] rounded-3xl border border-white/10 shadow-2xl p-7 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertCircle size={18} className="text-red-500" />
              </div>
              <p className="font-bold text-white">Delete this model?</p>
            </div>
            <p className="text-sm text-gray-400 mb-6 font-mono bg-white/5 rounded-lg px-3 py-2">
              {deleteTarget}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/15 text-sm font-semibold hover:bg-white/5 transition">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-bold transition">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2.5
          px-5 py-2.5 rounded-full text-sm font-semibold shadow-2xl backdrop-blur-md border transition-all
          ${toast.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
            : 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30'
          }`}>
          {toast.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, id: null })}
        onConfirm={executeReject}
        title="Reject Vehicle"
        message="Confirm rejection and delete this vehicle?"
        confirmText="Reject & Delete"
        cancelText="Cancel"
        isDestructive={true}
      />
      </div>
    </div>
  );
}
