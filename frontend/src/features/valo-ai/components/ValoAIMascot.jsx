export default function ValoAIMascot({ size = 72 }) {
  return (
    <svg width={size} height={size * 0.76} viewBox="0 0 96 73" role="img" aria-label="Xe VALO AI">
      <defs>
        <linearGradient id="valo-ai-car" x1="0" y1="0" x2="0.9" y2="1"><stop stopColor="#ffe29a"/><stop offset="0.55" stopColor="#ffba37"/><stop offset="1" stopColor="#b66312"/></linearGradient>
        <linearGradient id="valo-ai-glass" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#202530"/><stop offset="1" stopColor="#060a11"/></linearGradient>
      </defs>
      <ellipse cx="48" cy="68" rx="36" ry="5" fill="#000" opacity=".32"/>
      <rect x="24" y="5" width="48" height="10" rx="5" fill="#e8d3a1"/>
      <rect x="31" y="7" width="34" height="4" rx="2" fill="#33404b"/>
      <path d="M17 35 25 17Q28 10 38 10h20q10 0 13 7l8 18 3 15q1 10-8 12H22q-9-2-8-12z" fill="url(#valo-ai-car)" stroke="#fce4a7" strokeWidth="2"/>
      <path d="M29 18q3-3 9-3h20q6 0 9 3l6 18H23z" fill="url(#valo-ai-glass)" stroke="#b57729" strokeWidth="2"/>
      <path d="M14 41q34 9 68 0" fill="none" stroke="#ffda79" strokeWidth="2"/>
      <circle cx="27" cy="48" r="8" fill="#fff8d7"/><circle cx="69" cy="48" r="8" fill="#fff8d7"/>
      <circle cx="27" cy="48" r="4" fill="#182027"/><circle cx="69" cy="48" r="4" fill="#182027"/>
      <path d="M39 53q9 6 18 0" stroke="#283039" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <rect x="18" y="58" width="15" height="7" rx="3" fill="#1c2025"/><rect x="63" y="58" width="15" height="7" rx="3" fill="#1c2025"/>
    </svg>
  );
}
