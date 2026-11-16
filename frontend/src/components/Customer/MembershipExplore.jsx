import { useState } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { getPackageDurationLabel, getPackageTypeLabel } from '../../utils/ticketPackageRules';

const FILTERS = ['all', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const PAGE_SIZE = 6;
const TYPE_COLORS = {
  daily: 'bg-emerald-50 text-emerald-700',
  weekly: 'bg-teal-50 text-teal-700',
  monthly: 'bg-amber-50 text-amber-700',
  yearly: 'bg-purple-50 text-purple-700',
  custom: 'bg-indigo-50 text-indigo-700',
};

export default function MembershipExplore({ packages, onSelectPackage, buttonState }) {
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const filteredPackages = packages.filter((pkg) => type === 'all' || pkg.type === type);
  const totalPages = Math.ceil(filteredPackages.length / PAGE_SIZE);
  const currentPage = Math.min(page, totalPages || 1);
  const visiblePackages = filteredPackages.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section id="explore" aria-labelledby="membership-explore-heading" className="mt-12 pb-8">
      <h2 id="membership-explore-heading" className="mb-5 text-2xl font-bold text-slate-900">Explore more</h2>
      <div role="group" aria-label="Package type" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={type === value}
            onClick={() => { setType(value); setPage(1); }}
            className={`min-h-11 rounded-full border px-5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${type === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'}`}
          >
            {value === 'all' ? 'All packages' : getPackageTypeLabel(value)}
          </button>
        ))}
      </div>
      {visiblePackages.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePackages.map((pkg) => (
            <article key={pkg._id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className={`mb-4 inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-sm font-semibold ${TYPE_COLORS[pkg.type]}`}><CalendarDays size={16} aria-hidden="true" />{getPackageTypeLabel(pkg)}</span>
              <h3 className="text-lg font-bold text-slate-900">{pkg.name}</h3>
              <p className="mt-5 text-2xl font-black text-slate-900">{Number(pkg.price).toLocaleString('vi-VN')} <span className="text-sm">VND</span></p>
              <p className="mt-1 text-sm text-slate-500">/ {getPackageDurationLabel(pkg)} / space</p>
              {pkg.description && <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-600">{pkg.description}</p>}
              {pkg.benefits?.length > 0 && <ul className="mt-4 space-y-2 text-sm text-slate-600">{pkg.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>}
              <div className="mt-auto pt-6">
                <button
                  type="button"
                  disabled={buttonState.disabled}
                  onClick={() => onSelectPackage(pkg)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-[#181C23] px-4 py-3 text-left text-sm font-bold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  {buttonState.disabled ? buttonState.label : 'Choose package'}
                  {!buttonState.disabled && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : <p role="status" className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No additional packages in this category.</p>}
      {totalPages > 1 && (
        <nav aria-label="Package pages" className="mt-6 flex items-center justify-center gap-5">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-semibold disabled:opacity-40">Previous</button>
          <span className="text-sm text-slate-600">{currentPage} / {totalPages}</span>
          <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-semibold disabled:opacity-40">Next</button>
        </nav>
      )}
    </section>
  );
}
