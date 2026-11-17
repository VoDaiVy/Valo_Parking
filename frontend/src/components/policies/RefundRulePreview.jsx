import { Calculator } from 'lucide-react';
import { normalizeRefundRule } from '../../services/policyService';
import { useLanguage } from '../../i18n/hooks/useLanguage';

const money = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));

const percentOf = (amount, percent) => (amount * Number(percent || 0)) / 100;

export default function RefundRulePreview({ rule: rawRule, hasErrors = false }) {
  const { t } = useLanguage();
  const rule = normalizeRefundRule(rawRule);
  const sortedTiers = [...rule.cancellationTiers].sort(
    (a, b) => Number(b.minimumMinutesBeforeStart) - Number(a.minimumMinutesBeforeStart)
  );
  const prepaidParking = 120000;
  const actualCharge = 50000;
  const unusedParking = Math.max(0, prepaidParking - actualCharge);

  let earlyParkingRefund = 0;
  if (rule.earlyCheckout.mode === 'actual_usage') {
    earlyParkingRefund = unusedParking;
  } else if (rule.earlyCheckout.mode === 'fixed_refund_percent') {
    earlyParkingRefund = percentOf(unusedParking, rule.earlyCheckout.fixedRefundPercent);
  }
  earlyParkingRefund *= 1 - Number(rule.earlyCheckout.feePercent || 0) / 100;

  return (
    <aside className="rounded-3xl border border-white/10 bg-black/40 p-4 sm:p-5" aria-labelledby="refund-preview-title">
      <div className="mb-4 flex items-center gap-2">
        <Calculator size={17} className="text-yellow-300" />
        <h4 id="refund-preview-title" className="font-black">{t('policyUi.refund.preview')}</h4>
      </div>
      {hasErrors && (
        <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
          Fix validation errors before relying on this preview.
        </p>
      )}

      <div className="space-y-4 text-sm">
        <div>
          <p className="font-bold text-gray-200">{t('policyUi.refund.cancellationExample')}</p>
          <p className="mt-1 text-xs text-gray-500">Based on {money(prepaidParking)} prepaid parking.</p>
          <div className="mt-2 space-y-2">
            {sortedTiers.map((tier, index) => (
              <div key={`${tier.minimumMinutesBeforeStart}-${index}`} className="flex justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                <span className="text-gray-400">At least {tier.minimumMinutesBeforeStart || 0} min before</span>
                <span className="font-black text-emerald-300">
                  {tier.refundPercent || 0}% · {money(percentOf(prepaidParking, tier.refundPercent))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="font-bold text-gray-200">{t('policyUi.refund.checkoutExample')}</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {money(prepaidParking)} prepaid parking and {money(actualCharge)} actual parking charge.
          </p>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-3">
            <span className="text-gray-400">
              {rule.earlyCheckout.mode === 'actual_usage' && 'Actual usage'}
              {rule.earlyCheckout.mode === 'fixed_refund_percent' && `${rule.earlyCheckout.fixedRefundPercent || 0}% of unused parking`}
              {rule.earlyCheckout.mode === 'no_refund' && 'No parking refund'}
              {Number(rule.earlyCheckout.feePercent) > 0 && `, less ${rule.earlyCheckout.feePercent}% fee`}
            </span>
            <span className="font-black text-emerald-300">{money(earlyParkingRefund)}</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Minimum billable time: {rule.minimumBillableMinutes || 0} minutes. Add-on service fees are non-refundable.
          </p>
        </div>
      </div>
    </aside>
  );
}
