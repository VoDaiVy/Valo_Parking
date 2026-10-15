import { useState, useEffect, useRef } from 'react';
import {
  Upload, Trash2, RefreshCw, CheckCircle2, AlertCircle,
  Car, Loader2, FileBox, X, Eye, Palette,
} from 'lucide-react';
import { apiFetch, API_BASE } from '../../services/api';
import CarViewer from '../../components/CarViewer';

// ── helpers ────────────────────────────────────────────────────────────────
const authHeader = () => {
  const t = localStorage.getItem('accessToken');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Must match backend normalizeSlug
const normalizeSlug = (s = '') =>
  s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const previewPublicId = (brand, model) =>
  `vehicles/${normalizeSlug(brand) || '…'}/${normalizeSlug(model || 'default') || '…'}`;

// ── 3D Preview Modal ───────────────────────────────────────────────────────
function PreviewModal({ model, onClose }) {
  const [color, setColor] = useState('#c0392b');

  // Close on Escape
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

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p className="font-bold text-white text-sm">{model.publicId}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {(model.bytes / 1024).toFixed(0)} KB
              &nbsp;·&nbsp;
              {new Date(model.createdAt).toLocaleDateString('vi-VN')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* 3D Canvas */}
        <div className="relative h-72 sm:h-80 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
          <CarViewer modelUrl={model.url} carColor={color} height={320} />
        </div>

        {/* Color picker footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-white/10 bg-gray-950">
          <Palette size={15} className="text-gray-400 shrink-0" />
          <span className="text-xs text-gray-400 shrink-0">Paint color test:</span>
          <div className="flex items-center gap-2 flex-wrap">
            {['#c0392b','#2980b9','#27ae60','#f39c12','#8e44ad','#ecf0f1','#1a1a1a'].map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  color === c ? 'border-white scale-110' : 'border-white/20 hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
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

// ── API helpers ────────────────────────────────────────────────────────────
async function fetchModels() {
  return apiFetch('/admin/vehicles/models', {
    headers: authHeader(),
  });
}

async function uploadModel(brand, model, file) {
  const fd = new FormData();
  fd.append('brand', brand);
  fd.append('model', model || 'default');
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/admin/vehicles/upload-model`, {
    method: 'POST',
    headers: authHeader(),
    body: fd,
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

async function deleteModel(brand, model) {
  return apiFetch('/admin/vehicles/upload-model', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ brand, model }),
  });
}

async function syncModels() {
  return apiFetch('/admin/vehicles/sync-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
}

// ── Component ──────────────────────────────────────────────────────────────
export default function VehicleModels() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewModel, setPreviewModel] = useState(null);
  const fileRef = useRef();

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadModels = async () => {
    setLoading(true);
    const { ok, data } = await fetchModels();
    if (ok) setModels(data.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadModels();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!brand.trim()) return showToast('Enter Brand first', 'error');
    if (!file) return showToast('Choose a .glb file first', 'error');
    setUploading(true);
    const { ok, data } = await uploadModel(brand, model, file);
    setUploading(false);
    if (ok) {
      const synced = data.data?.vehiclesSynced ?? 0;
      showToast(`Uploaded: ${data.data?.publicId}${synced ? ` · updated ${synced} vehicles` : ''}`);
      setBrand(''); setModel(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await loadModels();
    } else {
      showToast(data.message || 'Upload failed', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    // publicId format: vehicles/{brand}/{model}
    const parts = deleteTarget.split('/');
    const { ok, data } = await deleteModel(parts[1] ?? '', parts[2] ?? 'default');
    setDeleteTarget(null);
    if (ok) {
      // Show how many vehicle documents had their modelUrl cleared
      const synced = data?.data?.vehiclesSynced ?? 0;
      showToast(`Model deleted${synced ? ` · removed 3D from ${synced} vehicles` : ''}`);
      await loadModels();
    } else {
      showToast(data?.message || 'Delete failed', 'error');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    const { ok, data } = await syncModels();
    setSyncing(false);
    if (ok) {
      showToast(`Sync complete · ${data.data?.updated ?? 0} vehicles updated`);
    } else {
      showToast(data?.message || 'Sync failed', 'error');
    }
  };

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-black ' +
    'px-3.5 py-2.5 text-sm text-white placeholder-gray-500 ' +
    'focus:outline-none focus:ring-1 focus:ring-yellow-500/50 transition shadow-inner';

  return (
    <div className="p-6 md:p-8 mx-auto min-h-[calc(100vh-70px)] overflow-auto bg-[#080808]">
      <div className="max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
            <Car size={12} /> Models
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">3D Vehicle Models</h1>
          <p className="text-gray-400 text-sm mt-1">Upload file <code className="font-mono bg-white/10 px-1 rounded">.glb</code> for each vehicle brand. The backend will match automatically when the user adds a vehicle.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-yellow-500/40
              bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400
              text-xs font-bold transition disabled:opacity-50"
            title="Sync modelUrl for all existing vehicles"
          >
            {syncing
              ? <Loader2 size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
            Sync vehicles
          </button>
          <button onClick={loadModels} className="p-2.5 rounded-xl border border-white/10 hover:bg-white/10 transition" title="Refresh list">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Convention note */}
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/8 px-5 py-4 mb-8 text-sm">
        <p className="font-bold text-yellow-600 dark:text-yellow-400 mb-1.5">Cloudinary naming rules</p>
        <p className="text-gray-700 dark:text-gray-300">
          Public ID will be generated automatically:&nbsp;
          <code className="font-mono bg-white/50 dark:bg-white/10 px-1.5 py-0.5 rounded">
            vehicles/&#123;brand&#125;/&#123;model&#125;
          </code>
        </p>
        <ul className="mt-2 space-y-0.5 text-gray-600 dark:text-gray-400 list-disc list-inside">
          <li>Brand + Model will be converted to <em>lowercase-slug</em> (spaces to hyphens)</li>
          <li>VD: <strong>Toyota</strong> + <strong>Land Cruiser</strong> → <code className="font-mono">vehicles/toyota/land-cruiser</code></li>
          <li>If Model is left blank -&gt; use <code className="font-mono">default</code> (fallback for the whole brand)</li>
        </ul>
      </div>

      {/* Upload form */}
      <form onSubmit={handleUpload}
        className="rounded-3xl border border-white/10 bg-[#171717] p-6 mb-8 shadow-sm">
        <h2 className="text-base font-bold text-white mb-5">Upload new model</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
              Brand <span className="text-red-500">*</span>
            </label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Toyota"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-semibold mb-1 block">
              Model <span className="text-gray-400">(blank = default)</span>
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Land Cruiser"
              className={inputCls}
            />
          </div>
        </div>

        {/* Path preview */}
        {brand && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Cloudinary path:&nbsp;
            <code className="font-mono bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-yellow-600 dark:text-yellow-400">
              {previewPublicId(brand, model)}
            </code>
          </p>
        )}

        {/* File drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 flex flex-col items-center gap-2 transition mb-5
            ${file
              ? 'border-yellow-500/50 bg-yellow-500/5'
              : 'border-white/15 hover:border-yellow-500/40 hover:bg-yellow-500/5'
            }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".glb"
            className="hidden"
            onChange={(e) => setFile(e.target.files[0] ?? null)}
          />
          {file ? (
            <>
              <FileBox size={28} className="text-yellow-500" />
              <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </>
          ) : (
            <>
              <Upload size={28} className="text-gray-400" />
              <p className="text-sm text-gray-500">Click to choose a file <strong>.glb</strong></p>
              <p className="text-xs text-gray-400">Maximum 50 MB</p>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading || !brand || !file}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl
            bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed
            text-black text-sm font-bold transition-colors"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {uploading ? 'Uploading...' : 'Upload Model'}
        </button>
      </form>

      {/* Model list */}
      <div className="rounded-3xl border border-white/10 bg-[#171717] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            Model list ({models.length})
          </h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-yellow-500" />
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-3">
            <Car size={28} className="text-gray-300 dark:text-white/20" />
            <p className="text-sm text-gray-500">No models yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {models.map((m) => (
              <li key={m.publicId} className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.03] group transition">
                <div className="w-9 h-9 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                  <Car size={16} className="text-yellow-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white font-mono truncate">
                    {m.publicId}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {(m.bytes / 1024).toFixed(0)} KB
                    &nbsp;·&nbsp;
                    {new Date(m.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </div>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline hidden sm:block shrink-0"
                >
                  URL
                </a>
                <button
                  onClick={() => setPreviewModel(m)}
                  className="p-2 rounded-lg text-gray-400 hover:text-yellow-500 hover:bg-yellow-500/10 transition opacity-0 group-hover:opacity-100"
                  title="Xem 3D"
                >
                  <Eye size={15} />
                </button>
                <button
                  onClick={() => setDeleteTarget(m.publicId)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3D Preview Modal */}
      {previewModel && (
        <PreviewModal model={previewModel} onClose={() => setPreviewModel(null)} />
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
            : 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
    </div>
  );
}
