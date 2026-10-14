export default function PriceBadge({ multiplier = 1, label }) {
  const value = Number(multiplier) || 1;
  if (value === 1) return null;
  const isPeak = value > 1;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
      isPeak
        ? 'border border-orange-200 bg-orange-100 text-orange-700'
        : 'border border-emerald-200 bg-emerald-100 text-emerald-700'
    }`}>
      {label || (isPeak ? 'Giá cao điểm' : 'Giá ưu đãi')}
    </span>
  );
}
