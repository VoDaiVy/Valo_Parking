import { useState } from 'react';
import {
  Sparkles,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Upload,
  Camera,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Crown,
  Car,
  Clock,
} from 'lucide-react';
import { resolveUnclearPlate } from '../../../services/aiPlateResolutionService';

export default function AIPlateResolutionModal({
  isOpen,
  onClose,
  onSelectPlate,
  initialPlate = '',
  initialImage = null,
}) {
  const [rawPlate, setRawPlate] = useState(initialPlate);
  const [imagePreview, setImagePreview] = useState(initialImage);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleResolve = async (plateToResolve = rawPlate, imageToUse = imagePreview) => {
    if (!plateToResolve && !imageToUse) {
      setError('Please enter a raw plate or upload an image');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await resolveUnclearPlate({
        rawPlate: plateToResolve,
        image: imageToUse,
        confidence: 60,
      });
      setResult(data);
    } catch (err) {
      setError(err.message || 'Failed to resolve plate');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
        handleResolve(rawPlate, reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const getSourceBadge = (source) => {
    switch (source) {
      case 'BOOKING_TODAY':
        return {
          label: "Today's Booking",
          icon: <Calendar size={12} />,
          cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        };
      case 'VIP_MEMBER':
        return {
          label: 'VIP Monthly Pass',
          icon: <Crown size={12} />,
          cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
        };
      case 'REGISTERED_VEHICLE':
        return {
          label: 'Registered Vehicle',
          icon: <Car size={12} />,
          cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        };
      case 'AI_VISION_ENHANCED':
        return {
          label: 'AI Vision Enhanced',
          icon: <Sparkles size={12} />,
          cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        };
      default:
        return {
          label: 'Recent Session',
          icon: <Clock size={12} />,
          cls: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#121316] text-white shadow-2xl shadow-black/80 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white shadow-lg shadow-violet-500/20">
              <Sparkles size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight text-white">
                  AI Blurred &amp; Occluded Plate Assistant
                </h3>
                <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] font-black uppercase text-violet-400 border border-violet-400/20">
                  ALPR Assistant
                </span>
              </div>
              <p className="text-xs font-medium text-gray-400">
                Auto Fuzzy Matching ALPR &amp; Gemini Vision enhancement
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="max-h-[75vh] overflow-y-auto p-6 space-y-5">
          
          {/* Input & Image Drop Zone */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
            <div className="sm:col-span-8 flex flex-col justify-between space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Raw License Plate (From Camera / OCR)
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={rawPlate}
                    onChange={(e) => setRawPlate(e.target.value.toUpperCase())}
                    placeholder="e.g. 51F-88B12, 30A-9O1.23..."
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm font-black tracking-wider text-white uppercase outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 placeholder:text-gray-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleResolve()}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2.5 text-xs font-black text-white shadow-lg shadow-violet-500/20 hover:from-fuchsia-400 hover:to-violet-400 disabled:opacity-50 transition"
                >
                  {loading ? (
                    <span className="animate-spin text-sm">⏳</span>
                  ) : (
                    <Search size={15} />
                  )}
                  <span>AI Analyze</span>
                </button>
              </div>
            </div>

            {/* Image upload preview */}
            <div className="sm:col-span-4">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1">
                Plate Image
              </label>
              <label className="flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-3 text-xs font-semibold text-gray-300 hover:border-violet-400 hover:bg-violet-400/5 transition overflow-hidden">
                {imagePreview ? (
                  <div className="flex items-center gap-2 truncate">
                    <img src={imagePreview} alt="Plate preview" className="h-6 w-10 object-cover rounded" />
                    <span className="text-[11px] text-violet-400">Image Attached</span>
                  </div>
                ) : (
                  <>
                    <Upload size={14} className="text-violet-400" />
                    <span>Upload Image</span>
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-xs font-semibold text-rose-300 flex items-center gap-2">
              <AlertTriangle size={15} className="text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* AI Resolution Results Card */}
          {result && (
            <div className="space-y-4">
              
              {/* Notice Banner */}
              <div className={`rounded-2xl border p-4 ${
                result.isResolved
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                  : 'border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-200'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-xl p-2 ${
                    result.isResolved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-fuchsia-500/20 text-fuchsia-400'
                  }`}>
                    {result.isResolved ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {result.isResolved ? 'High Confidence Match' : 'Staff Verification Required'}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed opacity-90">
                      {result.resolutionNotice}
                    </p>
                  </div>
                </div>
              </div>

              {/* Suggestions List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-400 px-1">
                  <span>Top Predicted Candidates ({result.topSuggestions?.length || 0})</span>
                  <span>Confidence</span>
                </div>

                {result.topSuggestions?.length === 0 ? (
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-8 text-center text-xs text-gray-500">
                    No matching vehicles found in database. You can use manual plate entry.
                  </div>
                ) : (
                  result.topSuggestions.map((item, idx) => {
                    const primarySource = item.sources?.[0] || 'RECENT_SESSION';
                    const badge = getSourceBadge(primarySource);

                    return (
                      <div
                        key={item.plate}
                        className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 hover:border-violet-400/50 hover:bg-white/[0.05] transition-all duration-200"
                      >
                        <div className="flex items-center gap-3.5">
                          {/* Rank number */}
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-black text-xs ${
                            idx === 0
                              ? 'bg-violet-400 text-white shadow-md shadow-violet-500/30'
                              : 'bg-white/10 text-gray-400'
                          }`}>
                            #{idx + 1}
                          </div>

                          {/* Plate display and metadata */}
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-black tracking-wider text-white font-mono bg-black/60 px-2.5 py-0.5 rounded-lg border border-white/15">
                                {item.formattedPlate}
                              </span>
                              <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                                {badge.icon}
                                <span>{badge.label}</span>
                              </span>
                            </div>

                            <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 font-medium">
                              {item.ownerName && <span>👤 {item.ownerName}</span>}
                              {item.phone && <span>📞 {item.phone}</span>}
                              {item.bookingInfo && (
                                <span className="text-violet-400/90 font-bold">
                                  🅿️ Slot {item.bookingInfo.slot} ({item.bookingInfo.time})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Similarity score & Action button */}
                        <div className="flex items-center gap-3 justify-between sm:justify-end shrink-0 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                          <div className="text-right">
                            <span className={`text-sm font-black ${
                              item.similarityScore >= 85 ? 'text-emerald-400' : 'text-violet-400'
                            }`}>
                              {item.similarityScore}%
                            </span>
                            <span className="block text-[10px] text-gray-500 font-semibold">AI Match</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              onSelectPlate && onSelectPlate(item.plate, item);
                              onClose();
                            }}
                            className="flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-violet-400 hover:text-white transition shadow-sm group-hover:scale-105"
                          >
                            <CheckCircle2 size={14} className="text-violet-400 group-hover:text-white" />
                            <span>1-Click Select</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-6 py-4 text-xs text-gray-400">
          <span>💡 Automatic ALPR Levenshtein distance matching against real-time bookings &amp; registered vehicles</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 font-bold text-gray-300 hover:bg-white/10 hover:text-white transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
