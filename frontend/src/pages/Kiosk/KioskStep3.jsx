import { useState, useEffect } from 'react';
import { Check, Loader2, AlertCircle, FileText } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import KioskFastPass from './KioskFastPass';
import { getPolicyBySlug } from '../../services/policyService';

export default function KioskStep3({ formData, onConfirm, onBack, onAutoCheckIn, onComplete, successSession }) {
  const isFastPassMode = formData.step3Mode === 'fastpass';
  const hasPolicyContext = Boolean(formData.licensePlate && formData.selectedSlot && formData.floorId);
  const hasFastPassContext = Boolean(formData.licensePlate && formData.selectedSlot && formData.floorId);

  if (isFastPassMode && !hasFastPassContext) {
    return <Navigate to="/kiosk" replace />;
  }

  if (!isFastPassMode && !hasPolicyContext) {
    return <Navigate to="/kiosk" replace />;
  }

  if (isFastPassMode || successSession) {
    return (
      <KioskFastPass
        formData={formData}
        isMonthly={formData.isMonthly}
        onAutoCheckIn={onAutoCheckIn}
        onComplete={onComplete}
        successSession={successSession}
      />
    );
  }

  return <StandardStep3 onConfirm={onConfirm} onBack={onBack} />;
}

function StandardStep3({ onConfirm, onBack }) {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [policyData, setPolicyData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getPolicyBySlug('booking-policy')
      .then(res => {
        if (res.ok && res.data?.success) {
          setPolicyData(res.data.data);
        } else {
          setError(res.data?.message || 'Policy not found');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const actualPolicy = policyData?.policy || policyData;
  const version = actualPolicy?.currentVersion || actualPolicy?.currentVersionId;

  return (
    <div className="flex w-full max-w-[600px] flex-1 flex-col mx-auto h-full font-sans pb-4 px-2 overflow-hidden">
      
      {/* Header */}
      <div className="mb-4 text-center shrink-0">
        <h2 className="text-2xl font-black uppercase tracking-tight text-[#0f172a]">Parking Policies</h2>
        <p className="text-sm font-medium text-gray-500">Please review before proceeding</p>
      </div>

      {/* REAL POLICY CONTENT */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-4 rounded-[20px] bg-white border-2 border-gray-100 p-5 shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
            <Loader2 className="animate-spin" size={32} />
            <p className="text-sm font-bold">Loading policies...</p>
          </div>
        ) : error || !actualPolicy || !version ? (
          <div className="flex flex-col items-center justify-center h-full text-red-500">
            <AlertCircle size={32} className="mb-2" />
            <p className="text-sm font-bold text-center">Failed to load policy</p>
            <p className="text-xs text-center mt-1">{error}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="text-xl font-black uppercase text-gray-900">{version.title || actualPolicy.title}</h3>
              <div className="mt-2 flex gap-2">
                <span className="bg-yellow-100 text-yellow-800 text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider">
                  Version {version.versionNumber}
                </span>
                <span className="bg-gray-100 text-gray-600 text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider">
                  {actualPolicy.category?.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {version.summary && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={16} className="text-blue-600" />
                  <span className="text-xs font-black uppercase text-blue-800">Key Takeaways</span>
                </div>
                <p className="text-sm font-medium text-blue-900">{version.summary}</p>
              </div>
            )}

            <div className="text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">
              {version.content}
            </div>
            
            {version.changeNote && (
              <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-xs font-medium text-yellow-800">
                <span className="font-black uppercase mr-1">Update:</span>
                {version.changeNote}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM SECTION */}
      <div className="shrink-0 space-y-4">
        {/* CHECKBOX */}
        <div 
          className="flex items-center gap-4 cursor-pointer group bg-gray-50 border-2 border-gray-100 p-4 rounded-[20px] transition-all hover:bg-gray-100 active:scale-[0.98]"
          onClick={() => setAgreed(!agreed)}
        >
          <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all shrink-0 ${agreed ? 'bg-emerald-500 border-emerald-500 text-white shadow-md' : 'border-gray-300 bg-white group-hover:border-gray-400'}`}>
            {agreed && <Check size={24} strokeWidth={4} />}
          </div>
          <p className="font-bold text-sm text-gray-700 leading-tight">
            I acknowledge that I have read and agree to abide by the above parking policies.
          </p>
        </div>

        {/* BOTTOM BUTTONS */}
        <div className="flex gap-3">
          <button 
            onClick={onBack}
            className="flex h-16 w-32 shrink-0 items-center justify-center rounded-[20px] border-4 border-gray-200 bg-white text-xl font-black text-gray-400 transition-all hover:border-gray-300 hover:text-gray-600 active:scale-95"
          >
            BACK
          </button>
          <button 
            onClick={() => {
              if (agreed) onConfirm();
            }}
            disabled={!agreed || loading || error || !actualPolicy}
            className={`group relative flex h-16 flex-1 items-center justify-center gap-3 overflow-hidden rounded-[20px] text-xl font-black transition-all ${
              !agreed || loading || error || !actualPolicy
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed border-none' 
                : 'bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] hover:bg-emerald-400 active:scale-95'
            }`}
          >
            {agreed && (
              <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-150%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(150%)]">
                <div className="relative h-full w-12 bg-white/20" />
              </div>
            )}
            <span>I AGREE & CONTINUE</span>
            {agreed && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-emerald-500 shrink-0">
                <Check size={18} strokeWidth={4} />
              </div>
            )}
          </button>
        </div>
      </div>

    </div>
  );
}
