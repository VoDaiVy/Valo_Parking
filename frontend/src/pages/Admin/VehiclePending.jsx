import { useState, useEffect } from 'react';
import { Car, Zap, Check, X, Loader2, RefreshCw, Image } from 'lucide-react';
import { apiFetch } from '../../services/api';
import ConfirmModal from '../../components/Admin/ConfirmModal';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

const VEHICLE_TYPE_LABELS = { car: 'Car', electric_car: 'Electric car' };

export default function VehiclePending() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState({}); // { [id]: true }
  const [toast, setToast] = useState(null);
  const [previewImg, setPreviewImg] = useState(null); // URL for lightbox
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, id: null });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPending = async () => {
    setLoading(true);
    const res = await apiFetch('/admin/vehicles/pending', { headers: authHeader() });
    setLoading(false);
    if (res.ok) setVehicles(res.data.data || []);
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchPending();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const handleApprove = async (id, modelUrl) => {
    setProcessing((p) => ({ ...p, [id]: true }));
    const res = await apiFetch(`/admin/vehicles/${id}/approve`, {
      method: 'PATCH',
      headers: authHeader(),
      body: JSON.stringify({ modelUrl: modelUrl || undefined }),
    });
    setProcessing((p) => ({ ...p, [id]: false }));
    if (res.ok) {
      showToast('Vehicle approved ✓');
      setVehicles((v) => v.filter((x) => x._id !== id));
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
      showToast('Vehicle rejected and deleted', 'error');
      setVehicles((v) => v.filter((x) => x._id !== id));
    } else {
      showToast(res.data?.message || 'Rejection failed', 'error');
    }
    setDeleteModal({ isOpen: false, id: null });
  };

  return (
    <div className="p-6 md:p-8 mx-auto min-h-[calc(100vh-70px)] overflow-auto bg-[#080808]">
      <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
            <Car size={12} /> Pending
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">Pending vehicles</h1>
          <p className="text-gray-400 text-sm mt-1">
            {vehicles.length > 0 ? `${vehicles.length} vehicles pending approval` : 'No vehicles pending approval'}
          </p>
        </div>
        <button
          onClick={fetchPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl
            border border-white/10
            text-sm font-semibold text-gray-300
            hover:border-yellow-500/40 hover:text-yellow-500 transition-all"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-24">
          <Loader2 size={28} className="animate-spin text-yellow-500" />
        </div>
      )}

      {/* Empty */}
      {!loading && vehicles.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/10
          bg-white/[0.02] flex flex-col items-center justify-center py-20 text-center">
          <Check size={32} className="text-green-400 mb-3" />
          <p className="font-bold text-gray-300">All vehicles have been approved</p>
          <p className="text-sm text-gray-400 mt-1">No vehicles are pending approval</p>
        </div>
      )}

      {/* List */}
      {!loading && vehicles.length > 0 && (
        <div className="flex flex-col gap-4">
          {vehicles.map((v) => (
            <VehicleApprovalCard
              key={v._id}
              vehicle={v}
              processing={!!processing[v._id]}
              onApprove={(modelUrl) => handleApprove(v._id, modelUrl)}
              onReject={() => handleReject(v._id)}
              onPreviewImage={setPreviewImg}
            />
          ))}
        </div>
      )}

      {/* Image lightbox */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImg(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={previewImg} alt="Vehicle registration card" className="w-full rounded-2xl shadow-2xl" />
            <button
              onClick={() => setPreviewImg(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60
                flex items-center justify-center text-white hover:bg-black/80 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]
          flex items-center gap-2.5 px-5 py-2.5 rounded-full text-sm font-semibold
          shadow-2xl backdrop-blur-md border transition-all duration-300
          ${toast.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border-red-500/30'
          }`}>
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
  );
}

// ─── Individual approval card ─────────────────────────────────────────────────
function VehicleApprovalCard({ vehicle, processing, onApprove, onReject, onPreviewImage }) {
  const [modelUrl, setModelUrl] = useState(vehicle.modelUrl || '');
  const typeLabel = VEHICLE_TYPE_LABELS[vehicle.vehicleType] || vehicle.vehicleType;

  return (
    <div className="rounded-3xl border border-white/10 bg-[#171717] shadow-sm flex flex-col sm:flex-row gap-4 p-5">

      {/* Registration card image */}
      <div className="shrink-0 w-full sm:w-44 h-32 rounded-xl overflow-hidden
        bg-black/30 border border-white/10
        flex items-center justify-center cursor-pointer group relative"
        onClick={() => vehicle.registrationCardImage && onPreviewImage(vehicle.registrationCardImage)}
      >
        {vehicle.registrationCardImage ? (
          <>
            <img
              src={vehicle.registrationCardImage}
              alt="Vehicle registration card"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30
              transition-all flex items-center justify-center">
              <Image size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            <Image size={24} />
            <span className="text-[10px]">No image</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="font-black text-base text-white">
            {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'No name yet'}
          </h3>
          <span className="text-[10px] font-bold bg-orange-500/15 text-orange-400
            border border-orange-500/30 rounded-full px-2 py-0.5">
            ⏳ Pending approval
          </span>
        </div>

        <p className="text-lg font-black font-mono text-gray-200 tracking-widest mb-2">
          {vehicle.licensePlate}
        </p>

        <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400 mb-3">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold
            bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
            {vehicle.vehicleType === 'electric_car' ? <Zap size={11} /> : <Car size={11} />}
            {typeLabel}
          </span>
          {vehicle.hexColor && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3.5 h-3.5 rounded-full border border-white/20"
                style={{ backgroundColor: vehicle.hexColor }} />
              <span className="font-mono text-xs">{vehicle.hexColor}</span>
            </span>
          )}
          <span>Owner: <span className="font-semibold text-gray-200">
            {vehicle.owner?.name || vehicle.owner?.email || '—'}
          </span></span>
        </div>

        {/* Model URL input */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={modelUrl}
            onChange={(e) => setModelUrl(e.target.value)}
            placeholder="3D model URL (optional)"
            className="flex-1 rounded-xl px-3 py-2 text-xs font-medium outline-none
              border border-white/10 bg-black text-white
              focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/20
              placeholder-gray-500 shadow-inner"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex sm:flex-col items-center justify-end gap-2 shrink-0">
        <button
          onClick={() => onApprove(modelUrl)}
          disabled={processing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold
            bg-green-500 hover:bg-green-400 text-white
            transition-colors disabled:opacity-50 shadow-md shadow-green-500/20"
        >
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={processing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold
            border border-red-500/30 text-red-400 hover:bg-red-500/10
            transition-colors disabled:opacity-50"
        >
          <X size={14} />
          Reject
        </button>
      </div>
    </div>
  );
}
