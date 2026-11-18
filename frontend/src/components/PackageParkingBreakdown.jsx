const time = (value) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
const interval = (value) => value ? `${time(value.start)} - ${time(value.end)}` : 'None';

export default function PackageParkingBreakdown({ pricing, paymentStatus = 'unpaid' }) {
  if (!pricing?.appliedEntitlement) return null;
  return <section aria-label="Package parking charges" className="my-3 min-w-0 rounded-xl border border-blue-400/25 bg-blue-950/40 p-4 font-['Montserrat',sans-serif] text-sm text-white [overflow-wrap:anywhere]">
    <p className="font-semibold text-blue-100">Package parking coverage</p>
    {pricing.packageExpired && <p className="mt-2 text-xs leading-relaxed text-blue-100">Your package expired at {time(pricing.appliedEntitlement.expireAt)}. Parking after this time is charged at standard rates.</p>}
    {pricing.packageService === 'RESERVED_PAID' && <p className="mt-2 text-xs text-blue-100">Your package reserves this space. Standard parking fees apply.</p>}
    <dl className="mt-3 space-y-2 text-xs leading-relaxed">
      <div><dt className="text-blue-200/75">Package</dt><dd>{pricing.packageName || 'Legacy parking package'}</dd></div>
      <div><dt className="text-blue-200/75">Service</dt><dd>{pricing.packageService === 'RESERVED_PAID' ? 'Reserved space: standard parking fees' : 'Reserved space: parking included while effective'}</dd></div>
      <div><dt className="text-blue-200/75">Payment status</dt><dd>{paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'pending' ? 'Awaiting bank payment verification' : 'Awaiting checkout settlement'}</dd></div>
      <div><dt className="text-blue-200/75">Covered time</dt><dd>{interval(pricing.coveredInterval)}</dd></div>
      <div><dt className="text-blue-200/75">Chargeable time</dt><dd>{interval(pricing.uncoveredInterval)}</dd></div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-blue-300/20 pt-3 text-sm"><dt>Final amount due</dt><dd className="font-bold">{Number(pricing.amountToPay).toLocaleString('en-GB')} VND</dd></div>
    </dl>
    {pricing.uncoveredInterval && <p className="mt-3 text-xs text-blue-100/75">Standard pricing blocks and caps apply to chargeable time. Block prices are not prorated.</p>}
  </section>;
}
