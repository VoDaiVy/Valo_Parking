import { packageDurationLabel, packageSalesAvailability } from '../../utils/ticketPackageTerms';

export default function PackageTermsSummary({ terms, purchased = false, showServices = true }) {
  if (!terms) return null;
  const availability = purchased ? null : packageSalesAvailability(terms);
  return <div className="my-3 space-y-1 text-sm leading-relaxed">
    <p>Duration: {packageDurationLabel(terms)}</p>
    {purchased && <p>Purchased price: {Number(terms.unitPrice ?? terms.price ?? 0).toLocaleString('en-GB')} VND per space</p>}
    {showServices && <>
      {terms.service && <p>{terms.service === 'RESERVED_PAID' ? 'Reserved space: standard parking fees apply.' : 'Reserved space: base parking included while effective.'}</p>}
      {terms.optionalServices?.length > 0 && <p>Optional services (paid separately, subject to availability): {terms.optionalServices.map((item) => item.name).join(', ')}.</p>}
      <p>Additional services are paid separately; no free service credits are included.</p>
    </>}
    {!purchased && terms.salesStartAt && <p>Sales start: {new Date(terms.salesStartAt).toLocaleString('en-GB')}</p>}
    {!purchased && terms.salesEndAt && <p>Sales end: {new Date(terms.salesEndAt).toLocaleString('en-GB')} (does not end purchased benefits)</p>}
    {availability && !availability.available && <p role="status" className="font-semibold text-amber-600">{availability.message}</p>}
  </div>;
}
