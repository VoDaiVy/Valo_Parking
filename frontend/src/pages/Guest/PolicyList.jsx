import { useLanguage } from '../../i18n/hooks/useLanguage';
import '../../components/policies/policies.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { getPolicies } from '../../services/policyService';

const categoryLabel = (value = '') =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Policy';

export default function PolicyList() {
  const { language } = useLanguage();
  const vi = language === 'vi';
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getPolicies()
      .then((res) => {
        if (res.ok && res.data?.success) {
          setPolicies(res.data.data || []);
        } else {
          setError(res.data?.message || 'Unable to load policies.');
        }
      })
      .catch(() => setError('Unable to load policies.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="policy-page bg-stone-50 pb-10 pt-20">
      <header className="border-b border-gold/20 bg-charcoal px-4 py-7 text-white sm:px-6 sm:py-9">
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-gold">
            <ShieldCheck size={14} />
            {vi ? 'Chính sách VALO' : 'VALO Policies'}
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            {vi ? 'Trung tâm pháp lý' : 'Legal Center'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-300">
            {vi ? 'Tìm hiểu các chính sách mới nhất về dịch vụ, đặt chỗ, ví và an toàn khách hàng tại VALO Parking.' : 'Review the latest published policies for services, bookings, wallet use, and customer safety.'}
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 pt-5 sm:px-6">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-3 rounded-[20px] border border-gray-200 bg-white py-10 text-sm font-bold text-gray-500">
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
            {vi ? 'Đang tải chính sách' : 'Loading policies'}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-[20px] border border-red-200 bg-red-50 p-8 text-red-700">{error}</div>
        ) : policies.length === 0 ? (
          <div className="rounded-[20px] border border-gray-200 bg-white p-10 text-center text-gray-500">
            {vi ? 'Chưa có chính sách được công bố.' : 'No published policies are available yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {policies.map((policy) => (
              <Link
                key={policy._id}
                to={`/policies/${policy.slug}`}
                className="group flex min-w-0 items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:gap-4 sm:p-5 [overflow-wrap:anywhere]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold/20 bg-gold/10 text-gold-deep">
                  <FileText size={19} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{categoryLabel(policy.category)}</p>
                <h2 className="text-base font-bold sm:text-lg text-gray-950">
                  {policy.currentVersion?.title || policy.title}
                </h2>
                <p className="mt-1 text-sm leading-5 text-gray-500">
                  {policy.currentVersion?.summary || policy.description || 'Read the latest published policy.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
                  <span className="rounded-md bg-gray-100 px-2 py-1">
                    {vi ? 'Phiên bản' : 'Version'} {policy.currentVersionNumber}
                  </span>
                  {policy.requiresAcceptance && (
                    <span className="rounded-md bg-gold/10 px-2 py-1 text-amber-700">
                      {vi ? 'Cần chấp nhận' : 'Acceptance required'}
                    </span>
                  )}
                  {!policy.requiresAcceptance && <span className="px-2 py-1">{vi ? 'Tham khảo' : 'For reference'}</span>}
                </div>
                </div>
                <ArrowRight size={18} className="mt-2 shrink-0 text-gray-400 group-hover:text-gold-deep" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
