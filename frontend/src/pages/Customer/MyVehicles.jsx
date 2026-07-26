import { useState, useEffect, useRef } from 'react';
import {
  Car, Zap, Plus, Trash2, Star, ScanLine,
  Upload, X, Check, Pencil, AlertCircle, Loader2,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';
import {
  getMyVehicles, addVehicle, updateVehicle,
  deleteVehicle, setDefaultVehicle, scanRegistrationCard,
  MAX_VEHICLES_PER_USER,
} from '../../services/vehicleService';
import CarViewer from '../../components/CarViewer';
import CustomerPageHeader from '../../components/Customer/CustomerPageHeader';
import garageBg from '../../assets/images/garage-bg.png';
import { formatLicensePlateDisplay, normalizeLicensePlate } from '../../utils/licensePlate';

// ─── Constants ────────────────────────────────────────────────────────────────
const VEHICLE_TYPES = [
  { value: 'car', label: 'Car', icon: <Car size={15} /> },
  { value: 'electric_car', label: 'Electric car', icon: <Zap size={15} /> },
];

const EMPTY_FORM = {
  licensePlate: '',
  vehicleType: 'car',
  brand: '',
  model: '',
  hexColor: '#ffffff',
  nickname: '',
};

// ─── Vehicle Card ─────────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onDelete, onSetDefault, onEdit }) {
  const [loading, setLoading] = useState(false);
  const typeObj = VEHICLE_TYPES.find((t) => t.value === vehicle.vehicleType);

  const handleDelete = async () => {
    setLoading(true);
    await onDelete(vehicle._id);
    setLoading(false);
  };

  const handleDefault = async () => {
    if (vehicle.isDefault) return;
    setLoading(true);
    await onSetDefault(vehicle._id);
    setLoading(false);
  };

  return (
    <div
      className={`relative rounded-2xl p-5 border transition-all duration-300
        bg-white dark:bg-white/[0.04] backdrop-blur-md
        ${vehicle.isDefault
          ? 'border-yellow-500/40 shadow-[0_0_24px_rgba(234,179,8,0.12)]'
          : 'border-gray-200 dark:border-white/10 hover:border-yellow-500/30 hover:shadow-[0_0_24px_rgba(234,179,8,0.08)]'
        }`}
    >
      {/* Default badge */}
      {vehicle.isDefault && (
        <span className="absolute top-3 right-3 text-[10px] font-bold
          bg-yellow-500/15 text-yellow-500 dark:text-yellow-400
          border border-yellow-500/30 rounded-full px-2 py-0.5 select-none">
          Default
        </span>
      )}

      {/* 3D Model Preview */}
      {vehicle.modelUrl && (
        <div className="w-full h-44 rounded-xl overflow-hidden mb-4
          bg-gray-100 dark:bg-black/30 border border-gray-200 dark:border-white/10">
          <CarViewer
            modelUrl={vehicle.modelUrl}
            carColor={vehicle.hexColor || '#ffffff'}
            height={176}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20
          flex items-center justify-center text-yellow-500 dark:text-yellow-400 shrink-0">
          {typeObj?.icon ?? <Car size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base text-gray-900 dark:text-white tracking-wide">
            {formatLicensePlateDisplay(vehicle.licensePlateDisplay || vehicle.licensePlate)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate flex items-center gap-1.5">
            {vehicle.hexColor && vehicle.hexColor !== '#ffffff' && (
              <span
                className="inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-white/20 shrink-0"
                style={{ backgroundColor: vehicle.hexColor }}
              />
            )}
            {[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* Nickname */}
      {vehicle.nickname && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 italic">
          "{vehicle.nickname}"
        </p>
      )}

      {/* Type badge */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold
          bg-yellow-500/10 text-yellow-600 dark:text-yellow-400
          border border-yellow-500/20 rounded-full px-2.5 py-0.5">
          {typeObj?.icon}
          {typeObj?.label ?? vehicle.vehicleType}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!vehicle.isDefault && (
          <button
            onClick={handleDefault}
            disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-semibold
              text-gray-500 dark:text-gray-400 hover:text-yellow-500 dark:hover:text-yellow-400
              transition-colors disabled:opacity-50"
            title="Set as default vehicle"
          >
            <Star size={13} />
            Default
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onEdit(vehicle)}
          disabled={loading}
          className="p-1.5 rounded-lg text-gray-400 hover:text-yellow-500 dark:hover:text-yellow-400
            hover:bg-yellow-500/10 transition-all disabled:opacity-50"
          title="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500
            hover:bg-red-500/10 transition-all disabled:opacity-50"
          title="Delete vehicle"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Vehicle Modal (Add / Edit) ───────────────────────────────────────────────
function DeleteVehicleModal({ vehicle, deleting, onCancel, onConfirm }) {
  if (!vehicle) return null;

  const plate = formatLicensePlateDisplay(vehicle.licensePlateDisplay || vehicle.licensePlate);
  const vehicleName = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'This vehicle';

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl
        border border-white/10 bg-[#101010]/95 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-500 via-yellow-400 to-red-500" />
        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          className="absolute right-4 top-4 rounded-xl p-2 text-white/45
            hover:bg-white/10 hover:text-white transition-all disabled:opacity-40"
          title="Close"
        >
          <X size={18} />
        </button>

        <div className="px-6 pb-6 pt-7">
          <div className="mb-5 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl
              border border-red-500/30 bg-red-500/15 text-red-300 shadow-[0_0_28px_rgba(239,68,68,0.16)]">
              <AlertTriangle size={24} />
            </div>
            <div className="min-w-0 pr-8">
              <p className="text-lg font-black tracking-tight">Delete vehicle?</p>
              <p className="mt-1 text-sm leading-6 text-white/55">
                This vehicle will be removed from your garage. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/35">
              Selected vehicle
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div
                className="h-9 w-9 rounded-full border-2 border-white/25 shadow-lg"
                style={{ backgroundColor: vehicle.hexColor || '#ffffff' }}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white/80">{vehicleName}</p>
                <p className="text-xl font-black leading-tight tracking-[0.16em] text-white">
                  {plate}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3
                text-sm font-bold text-white/65 transition-all hover:bg-white/10 hover:text-white
                disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl
                bg-red-500 px-4 py-3 text-sm font-black text-white shadow-lg shadow-red-500/20
                transition-all hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleModal({ editVehicle, onClose, onSaved }) {
  const [form, setForm] = useState(editVehicle
    ? {
        licensePlate: editVehicle.licensePlateDisplay || editVehicle.licensePlate,
        vehicleType: editVehicle.vehicleType,
        brand: editVehicle.brand || '',
        model: editVehicle.model || '',
        hexColor: editVehicle.hexColor || '#ffffff',
        nickname: editVehicle.nickname || '',
      }
    : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const isEdit = !!editVehicle;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  // ── Image compression ──
  const compressImage = (file, maxPx = 1024, quality = 0.85) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

  // ── AI scan ──
  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError('');
    try {
      const base64 = await compressImage(file);
      setScanPreview(base64);
      const res = await scanRegistrationCard(base64);
      if (res.ok && res.data?.data) {
        const { nickname, brand, model, licensePlate, hexColor: aiHex } = res.data.data;
        console.log('[AI Scan] response data:', res.data.data);
        console.log('[AI Scan] hexColor from AI:', aiHex);
        const cleanPlate = normalizeLicensePlate(licensePlate);
        setForm((f) => ({
          ...f,
          nickname: nickname || f.nickname,
          brand: brand || f.brand,
          model: model || f.model,
          licensePlate: cleanPlate || f.licensePlate,
          hexColor: aiHex || f.hexColor,
        }));
      } else {
        setError(res.data?.message || 'Could not read the information. Please enter it manually.');
      }
    } catch {
      setError('Image processing error.');
    }
    setScanning(false);
  };

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isEdit && !scanPreview) {
      setError('Vehicle registration card image is required when adding a new vehicle.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = isEdit
      ? form
      : { ...form, registrationCardImage: scanPreview };
    const res = isEdit
      ? await updateVehicle(editVehicle._id, payload)
      : await addVehicle(payload);
    setSaving(false);
    if (res.ok) {
      onSaved(res.data.data, isEdit ? 'updated' : 'added');
    } else {
      const msg = res.data?.errors?.[0]?.message || res.data?.message || 'An error occurred.';
      setError(msg);
    }
  };

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm font-medium outline-none
    border transition-all duration-200
    bg-gray-50 border-gray-300 text-gray-900
    focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/30
    dark:bg-black/40 dark:border-white/15 dark:text-white
    dark:focus:border-yellow-500 dark:focus:ring-yellow-500/20
    placeholder:text-gray-400 dark:placeholder:text-gray-500`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-[#111111]
        border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
          border-b border-gray-200 dark:border-white/10">
          <h2 className="font-bold text-base text-gray-900 dark:text-white">
            {isEdit ? 'Edit vehicle' : 'Add new vehicle'}
          </h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto max-h-[calc(100vh-160px)]">
          {/* AI Scan Section */}
          {!isEdit && (
            <div className={`mb-5 rounded-xl border border-dashed p-4
              ${scanPreview
                ? 'border-green-500/40 bg-green-500/5'
                : 'border-yellow-500/30 bg-yellow-500/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                <ScanLine size={15} className="text-yellow-500 dark:text-yellow-400" />
                <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
                  Scan vehicle registration card with AI
                </span>
                <span className="text-[10px] text-red-400 font-semibold ml-auto">* Required</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Upload the registration image to automatically fill vehicle information and color
              </p>

              {scanPreview && (
                <div className="relative mb-3">
                  <img src={scanPreview} alt="preview"
                    className="w-full h-32 object-cover rounded-lg border border-gray-200 dark:border-white/10" />
                  <div className="absolute top-2 right-2 flex items-center gap-1
                    bg-green-500/20 border border-green-500/40 text-green-400
                    text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm">
                    <Check size={10} />
                    Scanned
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold
                    bg-yellow-500 hover:bg-yellow-400 text-black
                    transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {scanning
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Upload size={13} />}
                  {scanning ? 'Scanning...' : scanPreview ? 'Scan again' : 'Upload vehicle registration card'}
                </button>

                {/* Auto-detected color preview */}
                {form.hexColor && form.hexColor !== '#ffffff' && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span
                      className="inline-block w-5 h-5 rounded-full border-2 border-white/30 shadow"
                      style={{ backgroundColor: form.hexColor }}
                    />
                    Auto color: <span className="font-mono">{form.hexColor}</span>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={handleScanFile} />
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-500 dark:text-red-400
                bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* License plate */}
            <div>
              <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
                License plate *
              </label>
              <input name="licensePlate" value={form.licensePlate}
                onChange={handleChange} required
                placeholder="VD: 51A-123.45"
                className={inputCls} />
            </div>

            {/* Vehicle type */}
            <div>
              <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1.5 block">
                Vehicle type *
              </label>
              <div className="flex gap-2">
                {VEHICLE_TYPES.map((t) => (
                  <button key={t.value} type="button"
                    onClick={() => setForm((f) => ({ ...f, vehicleType: t.value }))}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
                      border transition-all duration-200
                      ${form.vehicleType === t.value
                        ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-600 dark:text-yellow-400'
                        : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-yellow-500/30'
                      }`}>
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Brand + Model */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
                  Brand
                </label>
                <input name="brand" value={form.brand} onChange={handleChange}
                  placeholder="Toyota, Honda..."
                  className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
                  Model
                </label>
                <input name="model" value={form.model} onChange={handleChange}
                  placeholder="Orangery, Civic..."
                  className={inputCls} />
              </div>
            </div>

            {/* Nickname */}
            <div>
              <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
                Nickname
              </label>
              <input name="nickname" value={form.nickname} onChange={handleChange}
                placeholder="Family car..."
                className={inputCls} />
            </div>

            {/* 3D paint color - auto from AI and adjustable */}
            <div>
              <label className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
                3D paint color (HEX) - auto from AI
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="hexColor"
                  value={form.hexColor}
                  onChange={handleChange}
                  className="h-9 w-9 cursor-pointer rounded-lg border border-gray-300 dark:border-white/15 bg-transparent p-0.5 shrink-0"
                  title="Adjust vehicle paint color"
                />
                <input
                  name="hexColor"
                  value={form.hexColor}
                  onChange={handleChange}
                  placeholder="#ffffff"
                  className={`${inputCls} flex-1`}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                  border border-gray-200 dark:border-white/10
                  text-gray-600 dark:text-gray-400
                  hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold
                  bg-yellow-500 hover:bg-yellow-400 text-black
                  transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2">
                {saving
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Check size={14} />}
                {isEdit ? 'Save changes' : 'Add vehicle'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── No 3D Model Placeholder ─────────────────────────────────────────────────
function NoModelPlaceholder({ hexColor }) {
  const accent = hexColor && hexColor !== '#ffffff' ? hexColor : null;
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 select-none">
      <div
        className="w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center"
        style={{
          borderColor: accent ? accent + '55' : 'rgba(255,255,255,0.12)',
          color:        accent ?? 'rgba(255,255,255,0.25)',
        }}
      >
        <Car size={38} />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.35)' }}>
        3D model is not available yet
      </p>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
        Admin will add the vehicle model soon
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MyVehicles() {
  const [vehicles, setVehicles]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editVehicle, setEditVehicle] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast]             = useState(null);
  const [quickColor, setQuickColor]   = useState(null); // local hex while picking
  const colorInputRef = useRef(null);
  const colorDebounceRef = useRef(null); // debounce timer to avoid setting state too quickly

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const fetchVehicles = async () => {
    setLoading(true);
    const { ok, data } = await getMyVehicles();
    if (ok) setVehicles(data.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchVehicles();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  // Auto-select default vehicle whenever list reloads
  useEffect(() => {
    if (vehicles.length > 0) {
      const defIdx = vehicles.findIndex((v) => v.isDefault);
      const timerId = window.setTimeout(() => {
        setSelectedIdx(defIdx >= 0 ? defIdx : 0);
      }, 0);
      return () => window.clearTimeout(timerId);
    }
  }, [vehicles]);

  const clampedIdx = Math.min(selectedIdx, Math.max(0, vehicles.length - 1));
  const selected   = vehicles[clampedIdx] ?? null;
  const typeObj    = VEHICLE_TYPES.find((t) => t.value === selected?.vehicleType);
  const vehicleLimitReached = vehicles.length >= MAX_VEHICLES_PER_USER;

  const handleSaved = async (_v, action) => {
    setModalOpen(false);
    setEditVehicle(null);
    await fetchVehicles();
    showToast(action === 'updated' ? 'Vehicle updated successfully ✓' : 'Vehicle added successfully ✓');
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleteTarget(selected);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    const { ok } = await deleteVehicle(deleteTarget._id);
    setActionLoading(false);
    if (ok) {
      setDeleteTarget(null);
      setSelectedIdx(0);
      await fetchVehicles();
      showToast('Vehicle deleted ✓');
    } else {
      showToast('Failed to delete vehicle', 'error');
    }
  };

  const handleSetDefault = async () => {
    if (!selected || selected.isDefault) return;
    setActionLoading(true);
    const { ok } = await setDefaultVehicle(selected._id);
    setActionLoading(false);
    if (ok) {
      await fetchVehicles();
      showToast('Default vehicle set ✓');
    } else {
      showToast('Action failed', 'error');
    }
  };

  const openAdd = () => {
    if (vehicleLimitReached) {
      showToast(`Each account can register up to ${MAX_VEHICLES_PER_USER} vehicles.`, 'error');
      return;
    }
    setEditVehicle(null);
    setModalOpen(true);
  };
  const openEdit = () => { if (selected) { setEditVehicle(selected); setModalOpen(true); } };

  // ── Inline quick-color ──
  // Debounce 40ms: ignore continuous calls while the user drags the color picker quickly,
  // only call setQuickColor when the user stops to avoid Maximum update depth errors.
  const handleQuickColorChange = (hex) => {
    if (!selected) return;
    clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => setQuickColor(hex), 40);
  };
  const handleQuickColorCommit = async (hex) => {
    if (!selected) return;
    setActionLoading(true);
    await updateVehicle(selected._id, { hexColor: hex, color: hex });
    setActionLoading(false);
    setQuickColor(null);
    await fetchVehicles();
    showToast('Vehicle color updated ✓');
  };
  const activeColor = quickColor ?? selected?.hexColor ?? '#ffffff';

  const prev = () => { setQuickColor(null); setSelectedIdx((i) => (i - 1 + vehicles.length) % vehicles.length); };
  const next = () => { setQuickColor(null); setSelectedIdx((i) => (i + 1) % vehicles.length); };

  // Reset quickColor whenever selected vehicle changes
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setQuickColor(null);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [clampedIdx]);

  // ── Keyboard arrow navigation ──
  useEffect(() => {
    if (vehicles.length <= 1) return;
    const handler = (e) => {
      if (e.key === 'ArrowLeft') {
        setQuickColor(null);
        setSelectedIdx((i) => (i - 1 + vehicles.length) % vehicles.length);
      }
      if (e.key === 'ArrowRight') {
        setQuickColor(null);
        setSelectedIdx((i) => (i + 1) % vehicles.length);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vehicles.length]);

  return (
    // ── Full-screen garage ──────────────────────────────────────────────────
    <div
      className="relative w-full overflow-hidden"
      style={{ minHeight: 'calc(100vh - 64px)' }}
    >
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${garageBg})` }}
      />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />

      {/* ── Top bar ── */}
      <CustomerPageHeader
        icon={Car}
        title="My Garage"
        description={vehicles.length > 0 ? `${vehicles.length}/${MAX_VEHICLES_PER_USER} vehicles` : 'No vehicles yet'}
        className="relative z-10 px-6 pb-4 pt-5"
        action={
          <button
            onClick={openAdd}
            disabled={vehicleLimitReached}
            title={vehicleLimitReached ? `Maximum ${MAX_VEHICLES_PER_USER} vehicles reached` : 'Add vehicle'}
            className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${
              vehicleLimitReached
                ? 'cursor-not-allowed border border-white/10 bg-white/5 text-white/40 shadow-none'
                : 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30 hover:bg-yellow-400'
            }`}
          >
            {vehicleLimitReached ? <Check size={15} /> : <Plus size={15} />}
            {vehicleLimitReached ? 'Vehicle limit reached' : 'Add vehicle'}
          </button>
        }
      />

      {/* ── Info sub-bar (below header) ── */}
      {!loading && selected && (
        <div className="relative z-10 mx-4 rounded-2xl
          bg-black/45 backdrop-blur-xl border border-white/10
          px-5 py-3 flex items-center gap-4">

          {/* Color swatch — click to pick */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => colorInputRef.current?.click()}
              className="w-9 h-9 rounded-full border-2 border-white/30
                shadow-lg transition-transform hover:scale-110 cursor-pointer"
              style={{ backgroundColor: activeColor }}
              title="Change vehicle color"
            />
            <input
              ref={colorInputRef}
              type="color"
              value={activeColor}
              onChange={(e) => handleQuickColorChange(e.target.value)}
              className="absolute opacity-0 w-0 h-0 pointer-events-none"
            />
            {/* Save button — only shown when color has changed */}
            {quickColor && quickColor !== selected?.hexColor && (
              <button
                onClick={() => handleQuickColorCommit(quickColor)}
                disabled={actionLoading}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold
                  bg-yellow-500 hover:bg-yellow-400 text-black transition-colors
                  disabled:opacity-50 shadow-md"
              >
                {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save color
              </button>
            )}
            {quickColor && quickColor !== selected?.hexColor && (
              <button
                onClick={() => setQuickColor(null)}
                className="p-1.5 rounded-lg text-white/40 hover:text-white/70
                  border border-white/10 hover:border-white/20 transition-colors"
                title="Cancel"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Name + big plate */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-white/80">
                {[selected?.brand, selected?.model].filter(Boolean).join(' ') || 'My vehicle'}
              </span>
              {selected?.isDefault && (
                <span className="text-[10px] font-bold bg-yellow-500/25 text-yellow-400
                  border border-yellow-500/40 rounded-full px-2 py-0.5">
                  ★ Default
                </span>
              )}
              {selected?.status === 'pending' && (
                <span className="text-[10px] font-bold bg-orange-500/20 text-orange-400
                  border border-orange-500/40 rounded-full px-2 py-0.5">
                  ⏳ Pending approval
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold
                bg-white/10 text-gray-300 border border-white/15 rounded-full px-2.5 py-0.5">
                {typeObj?.icon}
                {typeObj?.label ?? selected?.vehicleType}
              </span>
            </div>
            {/* Big license plate */}
            <p className="text-2xl font-black text-white tracking-[0.18em] mt-0.5 leading-tight">
              {formatLicensePlateDisplay(selected?.licensePlateDisplay || selected?.licensePlate)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {!selected?.isDefault && (
              <button
                onClick={handleSetDefault}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                  text-white/60 hover:text-yellow-400 border border-white/15
                  hover:border-yellow-500/40 bg-white/5 hover:bg-yellow-500/10
                  transition-all disabled:opacity-50"
              >
                <Star size={13} />
                Default
              </button>
            )}
            <button
              onClick={openEdit}
              disabled={actionLoading}
              className="p-2.5 rounded-xl text-white/60 hover:text-yellow-400
                border border-white/15 hover:border-yellow-500/40
                bg-white/5 hover:bg-yellow-500/10 transition-all disabled:opacity-50"
              title="Edit"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="p-2.5 rounded-xl text-white/60 hover:text-red-400
                border border-white/15 hover:border-red-500/30
                bg-white/5 hover:bg-red-500/10 transition-all disabled:opacity-50"
              title="Delete vehicle"
            >
              {actionLoading
                ? <Loader2 size={15} className="animate-spin" />
                : <Trash2 size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="relative z-10 flex justify-center items-center" style={{ height: 'calc(100vh - 180px)' }}>
          <Loader2 size={36} className="animate-spin text-yellow-400" />
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && vehicles.length === 0 && (
        <div className="relative z-10 flex flex-col items-center justify-center gap-5 text-center px-8"
          style={{ height: 'calc(100vh - 180px)' }}>
          <div className="w-20 h-20 rounded-2xl bg-yellow-500/15 border border-yellow-500/30
            flex items-center justify-center">
            <Car size={32} className="text-yellow-400" />
          </div>
          <div>
            <p className="font-bold text-white text-lg mb-1">No vehicles yet</p>
            <p className="text-white/50 text-sm">Add a vehicle to use the 3D garage feature</p>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-6 py-3 rounded-xl
              bg-yellow-500 hover:bg-yellow-400 text-black font-bold transition-colors">
            <Plus size={15} />
            Add your first vehicle
          </button>
        </div>
      )}

      {/* ── Main garage scene ── */}
      {!loading && vehicles.length > 0 && (
        <>
          {/* 3D viewer — fills remaining height below info bar */}
          <div className="relative z-10 flex items-center justify-center"
            style={{ height: 'calc(100vh - 220px)', minHeight: 300 }}>

            {/* Left arrow */}
            {vehicles.length > 1 && (
              <button
                onClick={prev}
                className="absolute left-4 z-20 w-12 h-12 rounded-full
                  bg-black/40 hover:bg-black/70 border border-white/20
                  flex items-center justify-center text-white
                  transition-all hover:scale-110 backdrop-blur-sm shadow-xl"
              >
                <ChevronLeft size={22} />
              </button>
            )}

            {/* 3D canvas or placeholder */}
            <div className="w-full h-full">
              {selected?.modelUrl ? (
                <CarViewer
                  modelUrl={selected.modelUrl}
                  carColor={activeColor}
                  height="100%"
                  boundsMargin={0.85}
                />
              ) : (
                <NoModelPlaceholder hexColor={selected?.hexColor} />
              )}
            </div>

            {/* Right arrow */}
            {vehicles.length > 1 && (
              <button
                onClick={next}
                className="absolute right-4 z-20 w-12 h-12 rounded-full
                  bg-black/40 hover:bg-black/70 border border-white/20
                  flex items-center justify-center text-white
                  transition-all hover:scale-110 backdrop-blur-sm shadow-xl"
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>

          {/* ── Dot indicators — absolute bottom-center ── */}
          {vehicles.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
              {vehicles.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { setQuickColor(null); setSelectedIdx(i); }}
                  className={`rounded-full transition-all duration-300 ${
                    i === clampedIdx
                      ? 'bg-yellow-400 w-6 h-2'
                      : 'bg-white/30 hover:bg-white/50 w-2 h-2'
                  }`}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <DeleteVehicleModal
        vehicle={deleteTarget}
        deleting={actionLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      {/* Modal */}
      {modalOpen && (
        <VehicleModal
          editVehicle={editVehicle}
          onClose={() => { setModalOpen(false); setEditVehicle(null); }}
          onSaved={handleSaved}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`
          fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]
          flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold
          shadow-2xl backdrop-blur-md border transition-all duration-300
          ${toast.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
            : 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30'
          }
        `}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
