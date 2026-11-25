import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import { getPolicySections } from './policySections';
import PolicyMarkdown, { PolicySectionLabel } from './PolicyMarkdown';
import './policies.css';

export default function PolicyContent({ policy, version, controls }) {
  const { language } = useLanguage();
  const vi = language === 'vi';
  if (!policy || !version) return null;
  const sections = getPolicySections(version.content);
  const showToc = sections.length >= 2 && String(version.content || '').trim().length >= 600;
  const date = version.effectiveDate ? new Date(version.effectiveDate) : null;
  const effective = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : (vi ? 'Chưa xác định' : 'Not set');
  const tocTitle = vi ? 'Trong chính sách này' : 'On this page';

  const tocNav = (
            <nav aria-label={tocTitle}>
              <p className="mb-3 hidden text-[10px] font-extrabold uppercase tracking-widest text-gray-500 lg:block">{tocTitle}</p>
              <ul className="space-y-1">
                {sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className={`block rounded-lg px-2 py-2.5 text-xs leading-5 text-gray-600 hover:bg-gold/10 hover:text-charcoal ${section.level > 2 ? 'ml-3 border-l border-gray-200' : 'font-semibold'}`}><PolicySectionLabel title={section.title} /></a></li>)}
              </ul>
            </nav>
  );

  return (
    <>
      <header className="border-b border-gold/20 bg-charcoal px-4 py-5 text-white sm:px-6 sm:py-7">
        <div className="mx-auto max-w-6xl [overflow-wrap:anywhere]">
          <Link to="/policies" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded text-xs font-bold text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
            <ArrowLeft size={15} aria-hidden="true" />{vi ? 'Tất cả chính sách' : 'All policies'}
          </Link>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gold">{policy.category?.replace(/_/g, ' ') || 'Policy'}</p>
          <h1 className="max-w-4xl text-2xl font-black leading-tight tracking-tight sm:text-3xl">{version.title || policy.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-300">
            <span>{vi ? 'Phiên bản' : 'Version'} <strong className="text-gold">{version.versionNumber}</strong></span>
            <span>{vi ? 'Hiệu lực' : 'Effective'} {effective}</span>
          </div>
          {controls && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">{controls}</div>}
        </div>
      </header>
      <div className={`mx-auto grid max-w-6xl items-start gap-5 px-4 py-6 sm:px-6 ${showToc ? 'lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8' : ''}`}>
        {showToc && (
          <aside className="policy-toc min-w-0 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
            <div className="hidden lg:block">{tocNav}</div>
            <details key={`${policy.slug}-${version.versionNumber}`} className="lg:hidden">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-bold">{tocTitle}<ChevronDown size={16} aria-hidden="true" /></summary>
              {tocNav}
            </details>
          </aside>
        )}
        <article className="mx-auto w-full min-w-0 max-w-3xl rounded-[20px] border border-gray-200 bg-white p-5 text-[15px] leading-7 text-gray-700 shadow-sm [overflow-wrap:anywhere] sm:p-7">
          {version.summary && <p className="mb-5 border-b border-gray-100 pb-4 font-medium text-gray-600">{version.summary}</p>}
          <PolicyMarkdown content={version.content} />
          {version.changeNote && <aside className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm text-charcoal"><strong>{vi ? 'Ghi chú thay đổi:' : 'Change note:'}</strong> {version.changeNote}</aside>}
        </article>
      </div>
    </>
  );
}
