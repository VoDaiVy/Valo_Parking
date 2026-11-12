import { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { getQuarterlyLeaderboardAdmin } from '../../services/loyaltyService';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const label = (quarter) => `Quý ${quarter.slice(-1)} / ${quarter.slice(0, 4)}`;

export default function QuarterlyLeaderboard({ onChooseRecipient }) {
  const [quarter, setQuarter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getQuarterlyLeaderboardAdmin(quarter);
      if (!response.ok) throw new Error(response.data?.message || 'Không tải được bảng xếp hạng.');
      setData(response.data.data);
      if (!quarter) setQuarter(response.data.data.quarter);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [quarter]);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  return <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6" aria-labelledby="leaderboard-title">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div><div className="flex items-center gap-2 text-yellow-300"><Trophy size={20} /><h2 id="leaderboard-title" className="text-xl font-bold">Khách hàng chi tiêu nhiều nhất</h2></div><p className="mt-1 text-sm text-white/50">Top 20 theo quý để chọn người nhận voucher. Hoàn tiền sẽ cập nhật thứ hạng.</p></div>
      <label className="flex items-center gap-2 text-sm text-white/60">Xem quý
        <select aria-label="Chọn quý" value={quarter} onChange={(event) => setQuarter(event.target.value)} disabled={!data || loading} className="rounded-lg border border-white/20 bg-[#171717] px-3 py-2 text-white outline-none focus:border-yellow-400">
          {(data?.availableQuarters || []).map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-red-300">{error} <button type="button" onClick={load} className="ml-2 underline">Thử lại</button></p>}
    {loading && <p className="py-6 text-center text-sm text-white/50">Đang tải bảng xếp hạng...</p>}
    {!loading && data && <>
      {data.leaders.length ? <ol className="divide-y divide-white/10">{data.leaders.map((row) => <li key={row.userId} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="w-9 shrink-0 font-bold tabular-nums text-yellow-300">#{row.rank}</span><span className="min-w-0 flex-1 truncate">{row.username}</span><strong className="tabular-nums">{money(row.total)}</strong>{onChooseRecipient && <button type="button" onClick={() => onChooseRecipient(row)} className="rounded-lg border border-yellow-400/30 px-3 py-2 text-xs font-bold text-yellow-300 hover:bg-yellow-400/10">Chọn để gửi voucher</button>}</li>)}</ol> : <p className="py-8 text-center text-sm text-white/50">Chưa có chi tiêu hợp lệ trong quý này.</p>}
    </>}
  </section>;
}
