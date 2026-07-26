import { ArrowDown, ArrowUp, Plus, Trash2, RotateCcw } from 'lucide-react';
import { normalizeRefundRule } from '../../services/policyService';
import AdminSelect from '../Admin/AdminSelect';

const asNumber = (value) => {
  if (value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const fieldClass =
  'w-full min-w-0 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white caret-yellow-300 outline-none focus:border-yellow-400';
const numberFieldClass =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const errorClass = 'mt-1 text-xs font-semibold text-red-300';
const earlyCheckoutModeOptions = [
  { value: 'actual_usage', label: 'Actual usage' },
  { value: 'fixed_refund_percent', label: 'Fixed refund percent' },
  { value: 'no_refund', label: 'No parking refund' },
];

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  min = 0,
  max,
  suffix,
  disabled = false,
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 flex min-h-8 items-end text-xs font-black uppercase leading-4 tracking-[0.14em] text-gray-500">
        {label}
      </span>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step="1"
          value={value}
          onChange={(event) => onChange(asNumber(event.target.value))}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${fieldClass} ${numberFieldClass} ${suffix ? 'pr-10' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
            {suffix}
          </span>
        )}
      </div>
      {error && <p id={`${id}-error`} className={errorClass}>{error}</p>}
    </label>
  );
}

export default function RefundRuleEditor({ value, onChange, errors = {} }) {
  const rule = normalizeRefundRule(value);
  const updateTier = (index, field, nextValue) => {
    const cancellationTiers = rule.cancellationTiers.map((tier, tierIndex) =>
      tierIndex === index ? { ...tier, [field]: nextValue } : tier
    );
    onChange({ ...rule, cancellationTiers });
  };

  const moveTier = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= rule.cancellationTiers.length) return;
    const cancellationTiers = [...rule.cancellationTiers];
    [cancellationTiers[index], cancellationTiers[target]] = [
      cancellationTiers[target],
      cancellationTiers[index],
    ];
    onChange({ ...rule, cancellationTiers });
  };

  const sortTiers = () => {
    const cancellationTiers = [...rule.cancellationTiers].sort(
      (a, b) => Number(b.minimumMinutesBeforeStart) - Number(a.minimumMinutesBeforeStart)
    );
    onChange({ ...rule, cancellationTiers });
  };

  return (
    <div className="space-y-6 rounded-3xl border border-yellow-400/20 bg-yellow-400/[0.04] p-4 sm:p-5">
      <div>
        <h4 className="font-black text-yellow-200">Executable refund rules</h4>
        <p className="mt-1 text-sm leading-6 text-gray-400">
          These values drive booking refunds. Save them with the legal policy text and review the examples before publishing.
        </p>
      </div>

      <fieldset>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <legend className="text-sm font-black text-white">Cancellation tiers</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sortTiers}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 hover:bg-white/5"
            >
              Sort longest first
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...rule,
                  cancellationTiers: [
                    ...rule.cancellationTiers,
                    { minimumMinutesBeforeStart: 0, refundPercent: 0 },
                  ],
                })
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-yellow-400/30 px-3 py-2 text-xs font-black text-yellow-300 hover:bg-yellow-400/10"
            >
              <Plus size={14} />
              Add tier
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs leading-5 text-gray-500">
          The matching tier with the highest eligible time threshold applies.
        </p>
        {errors.cancellationTiers && <p className={`mb-3 ${errorClass}`}>{errors.cancellationTiers}</p>}
        <div className="space-y-3">
          {rule.cancellationTiers.map((tier, index) => (
            <div
              key={`tier-${index}`}
              className="grid gap-3 rounded-2xl border border-white/10 bg-black/40 p-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <NumberField
                id={`refund-tier-${index}-minutes`}
                label="Minutes before start"
                value={tier.minimumMinutesBeforeStart}
                onChange={(nextValue) => updateTier(index, 'minimumMinutesBeforeStart', nextValue)}
                error={errors[`tier-${index}-minutes`]}
              />
              <NumberField
                id={`refund-tier-${index}-percent`}
                label="Parking refund"
                value={tier.refundPercent}
                onChange={(nextValue) => updateTier(index, 'refundPercent', nextValue)}
                error={errors[`tier-${index}-percent`]}
                max={100}
                suffix="%"
              />
              <div className="flex items-end gap-1">
                <button
                  type="button"
                  onClick={() => moveTier(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move cancellation tier ${index + 1} up`}
                  className="rounded-xl border border-white/10 p-3 text-gray-300 hover:bg-white/5 disabled:opacity-30"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => moveTier(index, 1)}
                  disabled={index === rule.cancellationTiers.length - 1}
                  aria-label={`Move cancellation tier ${index + 1} down`}
                  className="rounded-xl border border-white/10 p-3 text-gray-300 hover:bg-white/5 disabled:opacity-30"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...rule,
                      cancellationTiers: rule.cancellationTiers.filter((_, tierIndex) => tierIndex !== index),
                    })
                  }
                  aria-label={`Remove cancellation tier ${index + 1}`}
                  className="rounded-xl border border-red-500/20 p-3 text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <NumberField
          id="refund-no-show"
          label="No-show parking refund"
          value={rule.noShowRefundPercent}
          onChange={(noShowRefundPercent) => onChange({ ...rule, noShowRefundPercent })}
          error={errors.noShowRefundPercent}
          max={100}
          suffix="%"
        />
        <NumberField
          id="refund-minimum-billable"
          label="Minimum billable time"
          value={rule.minimumBillableMinutes}
          onChange={(minimumBillableMinutes) => onChange({ ...rule, minimumBillableMinutes })}
          error={errors.minimumBillableMinutes}
          max={1440}
          suffix="min"
        />
      </div>

      <fieldset className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <legend className="px-2 text-sm font-black text-white">Early checkout</legend>
        <div className="grid gap-4 md:grid-cols-3">
          <label htmlFor="early-checkout-mode" className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-gray-500">
              Refund mode
            </span>
            <AdminSelect
              value={rule.earlyCheckout.mode}
              onChange={(nextMode) =>
                onChange({
                  ...rule,
                  earlyCheckout: {
                    ...rule.earlyCheckout,
                    mode: nextMode,
                    fixedRefundPercent:
                      nextMode === 'fixed_refund_percent'
                        ? rule.earlyCheckout.fixedRefundPercent
                        : 0,
                  },
                })
              }
              options={earlyCheckoutModeOptions}
              icon={RotateCcw}
              className="w-full"
              ariaLabel="Select early checkout refund mode"
            />
            {errors['earlyCheckout-mode'] && <p className={errorClass}>{errors['earlyCheckout-mode']}</p>}
          </label>
          <NumberField
            id="early-checkout-fixed-refund"
            label="Unused parking refund"
            value={rule.earlyCheckout.fixedRefundPercent}
            onChange={(fixedRefundPercent) =>
              onChange({
                ...rule,
                earlyCheckout: { ...rule.earlyCheckout, fixedRefundPercent },
              })
            }
            error={errors['earlyCheckout-fixedRefundPercent']}
            max={100}
            suffix="%"
            disabled={rule.earlyCheckout.mode !== 'fixed_refund_percent'}
          />
          <NumberField
            id="early-checkout-fee"
            label="Fee on parking refund"
            value={rule.earlyCheckout.feePercent}
            onChange={(feePercent) =>
              onChange({
                ...rule,
                earlyCheckout: { ...rule.earlyCheckout, feePercent },
              })
            }
            error={errors['earlyCheckout-feePercent']}
            max={100}
            suffix="%"
          />
        </div>
      </fieldset>

    </div>
  );
}
