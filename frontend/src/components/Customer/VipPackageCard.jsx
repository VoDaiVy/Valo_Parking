import { ArrowRight, Check, Clock3, Crown, Sparkles } from 'lucide-react';
import PackageTermsSummary from '../membership/PackageTermsSummary';
import { packageDurationLabel, packageSalesAvailability } from '../../utils/ticketPackageTerms';

export default function VipPackageCard({ pkg, onSelect }) {
  const availability = packageSalesAvailability(pkg);
  const isMonthly = pkg.type === 'monthly';
  const isYearly = pkg.type === 'yearly';
  const Icon = isMonthly ? Crown : isYearly ? Sparkles : Clock3;
  const benefits = [...new Set([...(pkg.benefits || []), ...(pkg.features || [])])];

  return (
    <article className={`vip-package-card ${isYearly ? 'vip-package-card--yearly' : isMonthly ? 'vip-package-card--monthly' : 'vip-package-card--hourly'}`}>
      <div className="vip-package-card__heading">
        {(isMonthly || isYearly) && <span className="vip-package-card__badge">{isMonthly ? 'Popular' : 'Best value'}</span>}
        <div className="vip-package-card__icon"><Icon size={25} strokeWidth={1.8} /></div>
        <span className="vip-package-card__type">{isMonthly ? 'Monthly' : isYearly ? 'Yearly' : 'Hourly'}</span>
        <h3 className="vip-package-card__name" title={pkg.name}>{pkg.name}</h3>
      </div>

      <div className="vip-package-card__price-box">
        <p className="vip-package-card__price">{Number(pkg.price || 0).toLocaleString('vi-VN')} <span>VND</span></p>
        <p className="vip-package-card__duration">{packageDurationLabel(pkg)}</p>
      </div>

      <div className="vip-package-card__body">
        {benefits.length > 0 && <ul className="vip-package-card__benefits">
          {benefits.map((benefit) => <li key={benefit}><Check size={17} aria-hidden="true" /><span>{benefit}</span></li>)}
        </ul>}
        {(pkg.salesStartAt || pkg.salesEndAt) && <details className="vip-package-card__terms">
          <summary>Sales details</summary>
          <PackageTermsSummary terms={pkg} showServices={false} showDuration={false} />
        </details>}
        {!availability.available && <p role="status" className="vip-package-card__availability">{availability.message}</p>}
      </div>

      <button type="button" disabled={!availability.available} onClick={() => onSelect(pkg)} className="vip-package-card__action">
        <span>{availability.available ? 'Choose this package' : 'Currently unavailable'}</span>
        {availability.available && <ArrowRight size={17} aria-hidden="true" />}
      </button>
    </article>
  );
}
