import { useState, useEffect } from 'react';
import { ShieldCheck, CheckCircle2, ChevronDown, ChevronUp, FileText, Loader2, X, Info } from 'lucide-react';
import { acceptPolicy } from '../../services/policyService';

export default function PolicyAcceptancePrompt({
  open = false,
  missingPolicies = null,
  onClose,
  onAccepted,
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedPolicyIds, setExpandedPolicyIds] = useState(new Set());

  useEffect(() => {
    if (!open) return undefined;

    const timerId = window.setTimeout(() => {
      setExpandedId(null);
      setExpandedPolicyIds(new Set());
      setError('');
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [open]);

  if (!open) return null;

  const rawUser = sessionStorage.getItem('valo_user');
  const user = rawUser ? JSON.parse(rawUser) : null;
  const items = missingPolicies || [];

  const handleAcceptAll = async () => {
    if (!items.length) {
      onAccepted?.();
      onClose?.();
      return;
    }

    setAccepting(true);
    setError('');

    try {
      for (const policy of items) {
        const res = await acceptPolicy(policy.policyId);
        if (!res.ok || !res.data?.success) {
          throw new Error(res.data?.message || `Unable to accept ${policy.title}`);
        }
      }

      onAccepted?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Unable to accept policies.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 sm:p-6 backdrop-blur-md">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-[#161616] px-6 py-5 sm:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.15)]">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-white">Review Policies</h2>
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
        <div className="relative max-h-[55vh] overflow-y-auto px-6 py-6 sm:px-8 scroll-smooth">
          {items.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-emerald-400">
              <CheckCircle2 size={24} />
              <div>
                <p className="font-bold">You're all set!</p>
                <p className="text-sm opacity-80">All required policies are already accepted.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              
              <div className="flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-blue-300">
                <Info size={20} className="mt-0.5 shrink-0" />
                <p className="text-sm leading-relaxed">
                  We've summarized the key points below. Please expand and read all policies to confirm your acceptance.
                </p>
              </div>

              {items.map((policy) => {
                const isExpanded = expandedId === policy.policyId;
                return (
                  <div 
                    key={policy.policyId} 
                    className={`overflow-hidden rounded-2xl border transition-all ${
                      expandedPolicyIds.has(policy.policyId)
                        ? 'border-yellow-500/30 bg-[#1A1A1A]'
                        : 'border-white/5 bg-[#141414] hover:border-white/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : policy.policyId);
                        setExpandedPolicyIds(prev => {
                          const next = new Set(prev);
                          next.add(policy.policyId);
                          return next;
                        });
                      }}
                      className="flex w-full items-center justify-between gap-4 p-5 text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-gray-300">
                          <FileText size={18} />
                        </div>
                        <div>
                          <p className="font-bold text-white">{policy.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300">
                              v{policy.versionNumber}
                            </span>
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                              {policy.category}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-gray-500 transition-colors hover:text-white">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </button>
                    
                    {/* TL;DR / Summary Area */}
                    {isExpanded && (
                      <div className="border-t border-white/5 bg-[#141414]">
                        {/* Summary Section */}
                        <div className="px-6 py-5 border-b border-white/5">
                          <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-yellow-500">
                            Key Takeaways (TL;DR)
                          </h4>
                          <div className="text-sm leading-relaxed text-gray-300">
                            {policy.summary ? (
                              <p>{policy.summary}</p>
                            ) : (
                              <p className="italic opacity-60">No summary available.</p>
                            )}
                          </div>
                        </div>

                        {/* Full Content Section */}
                        {policy.content && (
                          <div className="px-6 py-5">
                            <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">
                              Full Policy Details
                            </h4>
                            <div className="text-sm leading-relaxed text-gray-400 whitespace-pre-wrap">
                              {policy.content}
                            </div>
                          </div>
                        )}

                        <div className="px-6 pb-5 pt-2">
                          <a
                            href={`/policies/${policy.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-bold text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            Open Policy Page <FileText size={14} />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-center text-sm font-bold text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 bg-[#161616] px-6 py-5 sm:px-8">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-5 py-3.5 text-sm font-bold text-gray-400 transition hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={accepting || user?.role !== 'customer' || expandedPolicyIds.size < items.length || items.length === 0}
              onClick={handleAcceptAll}
              className={`group flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-black transition-all ${
                expandedPolicyIds.size < items.length && items.length > 0
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.3)] hover:bg-yellow-400 hover:shadow-[0_0_25px_rgba(234,179,8,0.5)]'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {accepting && <Loader2 size={18} className="animate-spin" />}
              {items.length === 0
                ? 'Continue'
                : expandedPolicyIds.size < items.length
                ? `Expand All Policies to Accept (${expandedPolicyIds.size}/${items.length})`
                : 'I Agree & Continue'}
            </button>
          </div>
        </div>
        
      </div>
    </div>
  );
}
