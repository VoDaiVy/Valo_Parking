import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import {
  createSubscriptionPayment, createEntitlementRenewalPayment, createRenewalPayment,
  verifySubscriptionPayment, verifyEntitlementRenewalPayment, verifyRenewalPayment,
} from '../../services/subscriptionService';

export default function MembershipPaymentRecovery({ payments = [], onRefresh, light = false }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (!payments.length) return null;
  const resume = async (payment) => {
    if (busy) return;
    if (payment.reconciliationRequired) { setError('Payment received; activation requires reconciliation. Do not pay again. Contact support with the order reference.'); return; }
    setBusy(payment.orderCode); setError('');
    try {
      const verify = payment.kind === 'purchase' ? verifySubscriptionPayment : payment.kind === 'entitlement' ? verifyEntitlementRenewalPayment : verifyRenewalPayment;
      const result = await verify(payment.orderCode);
      if (result.ok && result.data?.success) { await onRefresh?.(); return; }
      if (result.data?.code === 'PAYMENT_ORDER_CLOSED') { await onRefresh?.(); throw new Error('This payment was closed. You can start a new purchase or renewal.'); }
      if (result.data?.code !== 'PAYMENT_NOT_COMPLETED') throw new Error(result.data?.message || 'Unable to verify this payment. Keep the order reference.');
      let url = payment.checkoutUrl;
      if (!url) {
        const recovered = payment.kind === 'purchase'
          ? await createSubscriptionPayment(payment.packageId, payment.slots, undefined, payment.idempotencyKey)
          : payment.kind === 'entitlement'
            ? await createEntitlementRenewalPayment(payment.targetId, payment.idempotencyKey)
            : await createRenewalPayment(payment.targetId, payment.idempotencyKey);
        if (!recovered.ok || !recovered.data?.success) throw new Error(recovered.data?.message || 'Unable to recover the payment link. Retry the same order.');
        url = recovered.data.data?.checkoutUrl;
      }
      if (!url) throw new Error('The payment link is unavailable. Keep the order reference and contact support.');
      window.location.assign(url);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };
  return <section aria-label="Pending membership payments" className={`my-6 min-w-0 rounded-xl border p-4 font-['Montserrat',sans-serif] ${light ? 'border-amber-200 bg-white text-slate-900' : 'border-amber-300/20 bg-[#111318] text-white'}`}>
    <h2 className="flex items-center gap-2 text-sm font-semibold"><CreditCard size={18} /> Pending membership payments</h2>
    <p className="mt-2 text-xs opacity-70">Resume the original order or verify a completed payment before paying again.</p>
    <div className="mt-3 divide-y divide-current/10">{payments.map((payment) => <div key={`${payment.kind}:${payment.orderCode}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 text-xs [overflow-wrap:anywhere]"><p className="font-semibold">{payment.name}</p>{payment.reconciliationRequired && <p role="status" className="mt-1">Payment received; activation requires reconciliation. Do not pay again.</p>}<p className="mt-1 opacity-70">Order {payment.orderCode} / {Number(payment.amount).toLocaleString('en-GB')} VND</p></div>
      <button type="button" disabled={busy !== null} onClick={() => resume(payment)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-400/40 px-3 text-xs font-semibold disabled:opacity-50">{busy === payment.orderCode && <Loader2 size={14} className="animate-spin" />} {payment.reconciliationRequired ? 'View payment status' : 'Resume / verify'}</button>
    </div>)}</div>
    {error && <p role="alert" className={`mt-3 text-xs ${light ? 'text-red-700' : 'text-rose-300'}`}>{error}</p>}
  </section>;
}
