import { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Loader2, X, FileText, Info } from 'lucide-react';
import { getPolicyBySlug, acceptPolicy } from '../../services/policyService';

export default function BookingPolicyModal({ open, onClose, onConfirm, title = "Review Policies & Terms" }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [policyData, setPolicyData] = useState(null);
  const [error, setError] = useState(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const timerId = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setHasScrolledToBottom(false);
      
      getPolicyBySlug('booking-policy')
        .then(res => {
          if (res.ok && res.data?.success) {
            setPolicyData(res.data.data);
            
            // Check if content is small enough to not require scrolling
            setTimeout(() => {
              if (scrollRef.current) {
                const { scrollHeight, clientHeight } = scrollRef.current;
                if (scrollHeight <= clientHeight + 10) {
                  setHasScrolledToBottom(true);
                }
              }
            }, 200);
          } else {
            setError(res.data?.message || 'Policy not found');
          }
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [open]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop + clientHeight >= scrollHeight - 5) {
      setHasScrolledToBottom(true);
    }
  };

  const actualPolicy = policyData?.policy || policyData;
  const version = actualPolicy?.currentVersion || actualPolicy?.currentVersionId;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 sm:p-6 backdrop-blur-md">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] shadow-2xl max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-[#161616] px-6 py-5 sm:px-8 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.15)]">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-white uppercase">{title}</h2>
              <p className="text-sm font-medium text-gray-400">
                Please review and accept our latest terms
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto px-6 py-6 sm:px-8 scroll-smooth"
        >
          {loading ? (
             <div className="flex flex-col justify-center items-center py-20 gap-4 text-gray-400">
               <Loader2 className="animate-spin" size={32} />
               <p className="text-sm font-semibold">Loading policies...</p>
             </div>
          ) : error || !policyData || !version ? (
             <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 flex items-start gap-3 text-red-400">
               <ShieldCheck size={24} className="mt-0.5 shrink-0" />
               <div>
                 <h3 className="font-bold">Failed to load booking policy</h3>
                 <p className="text-sm mt-1 opacity-80">{error || 'The policy data could not be retrieved from the server.'}</p>
               </div>
             </div>
          ) : (
             <div className="flex flex-col gap-6">
               <div className="flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-blue-300">
                 <Info size={20} className="mt-0.5 shrink-0" />
                 <p className="text-sm leading-relaxed">
                   Please review the key points below. You must scroll to the bottom of the terms to enable the Agree button.
                 </p>
               </div>

               {/* TL;DR Section */}
               <div className="rounded-2xl border border-white/5 bg-[#1A1A1A] overflow-hidden">
                  <div className="border-b border-white/5 bg-[#141414] px-6 py-4 flex items-center gap-3">
                    <FileText size={18} className="text-yellow-500" />
                    <h4 className="text-sm font-bold uppercase tracking-widest text-yellow-500">
                      Key Takeaways (TL;DR)
                    </h4>
                  </div>
                  <div className="px-6 py-5 text-sm leading-relaxed text-gray-300">
                    {version.summary ? (
                      <p>{version.summary}</p>
                    ) : (
                      <p className="italic opacity-60">No summary available for {version.title || actualPolicy.title}.</p>
                    )}
                  </div>
               </div>

               {/* Full Policy Text Section */}
               <div className="rounded-2xl border border-white/5 bg-[#1A1A1A] p-6 text-sm leading-8 text-gray-400">
                  <div className="mb-4 flex flex-wrap gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    <span className="rounded-md bg-white/10 px-2 py-1">
                      Version {version.versionNumber}
                    </span>
                    <span className="rounded-md bg-white/10 px-2 py-1">
                      {actualPolicy.category?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  
                  <div className="whitespace-pre-wrap">
                    {version.content}
                  </div>
                  
                  {version.changeNote && (
                    <div className="mt-8 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-yellow-500">
                      <span className="font-black block mb-1 uppercase text-xs tracking-wider">Update Notes:</span> 
                      {version.changeNote}
                    </div>
                  )}
               </div>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 bg-[#161616] px-6 py-5 sm:px-8 shrink-0">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl px-6 py-3.5 text-sm font-bold text-gray-400 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !hasScrolledToBottom || loading || error || !policyData}
              onClick={async () => {
                if (policyData?.policy?._id || policyData?._id) {
                  setSubmitting(true);
                  try {
                    await acceptPolicy(policyData?.policy?._id || policyData?._id);
                  } catch (err) {
                    console.error('Failed to accept policy', err);
                  } finally {
                    setSubmitting(false);
                  }
                }
                onConfirm();
              }}
              className={`group flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-black transition-all ${
                !hasScrolledToBottom
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.3)] hover:bg-yellow-400 hover:shadow-[0_0_25px_rgba(234,179,8,0.5)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {submitting && <Loader2 size={18} className="animate-spin" />}
              {!hasScrolledToBottom
                ? 'Scroll to Bottom to Accept'
                : 'I Agree & Continue'}
            </button>
          </div>
        </div>
        
      </div>
    </div>
  );
}
