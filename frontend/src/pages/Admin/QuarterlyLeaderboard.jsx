import { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { getQuarterlyLeaderboardAdmin } from '../../services/loyaltyService';
import { useLanguage } from '../../i18n/hooks/useLanguage';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

export default function QuarterlyLeaderboard({ onChooseRecipient }) {
  const { t, language } = useLanguage();
  const [quarter, setQuarter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await getQuarterlyLeaderboardAdmin(quarter);
      if (!response.ok) throw new Error(response.data?.message || t('common.noData'));
      setData(response.data.data);
      if (!quarter) setQuarter(response.data.data.quarter);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [quarter, t]);

  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const quarterLabel = (value) => `${language === 'vi' ? 'Quý' : 'Quarter'} ${value.slice(-1)} / ${value.slice(0, 4)}`;

  return (
    <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6" aria-labelledby="leaderboard-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div><div className="flex items-center gap-2 text-yellow-300"><Trophy size={20} /><h2 id="leaderboard-title" className="text-xl font-bold">{t('adminPages.leaderboard.title')}</h2></div><p className="mt-1 text-sm text-white/50">{t('adminPages.leaderboard.subtitle')}</p></div>
        <label className="flex items-center gap-2 text-sm text-white/60">{language === 'vi' ? 'Xem quý' : 'View quarter'}
          <select aria-label={language === 'vi' ? 'Chọn quý' : 'Select quarter'} value={quarter} onChange={(event) => setQuarter(event.target.value)} disabled={!data || loading} className="rounded-lg border border-white/20 bg-[#171717] px-3 py-2 text-white outline-none focus:border-yellow-400">
            {(data?.availableQuarters || []).map((value) => <option key={value} value={value}>{quarterLabel(value)}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-300">{error} <button type="button" onClick={load} className="ml-2 underline">{t('common.retry')}</button></p>}
      {loading && <p className="py-6 text-center text-sm text-white/50">{t('common.loading')}</p>}
      {!loading && data && (data.leaders.length ? <ol className="divide-y divide-white/10">{data.leaders.map((row) => <li key={row.userId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="w-9 shrink-0 font-bold tabular-nums text-yellow-300">#{row.rank}</span><span className="min-w-0 flex-1 truncate">{row.username}</span><strong className="tabular-nums">{money(row.total)}</strong>{onChooseRecipient && <button type="button" onClick={() => onChooseRecipient(row)} className="rounded-lg border border-yellow-400/30 px-3 py-2 text-xs font-bold text-yellow-300 hover:bg-yellow-400/10">{language === 'vi' ? 'Chọn để gửi voucher' : 'Select for voucher'}</button>}</li>)}</ol> : <p className="py-8 text-center text-sm text-white/50">{language === 'vi' ? 'Chưa có chi tiêu hợp lệ trong quý này.' : 'No eligible spending in this quarter.'}</p>)}
    </section>
  );
}
