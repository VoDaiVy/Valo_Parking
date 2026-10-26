import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

// Share the web mascot's geometry and colors without scaling a screenshot.
export function ValoAIMascot({ size = 82 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const car = `valo-car-${id}`;
  const glass = `valo-glass-${id}`;
  return (
    <Svg width={size} height={size * 0.76} viewBox="0 0 96 73" accessible={false}>
      <Defs>
        <LinearGradient id={car} x1="0%" y1="0%" x2="90%" y2="100%">
          <Stop offset="0" stopColor="#ffe29a" />
          <Stop offset="0.55" stopColor="#ffba37" />
          <Stop offset="1" stopColor="#b66312" />
        </LinearGradient>
        <LinearGradient id={glass} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#202530" />
          <Stop offset="1" stopColor="#060a11" />
        </LinearGradient>
      </Defs>
      <Ellipse cx="48" cy="68" rx="36" ry="5" fill="#000" opacity={0.32} />
      <Rect x="24" y="5" width="48" height="10" rx="5" fill="#e8d3a1" />
      <Rect x="31" y="7" width="34" height="4" rx="2" fill="#33404b" />
      <Path
        d="M17 35 25 17Q28 10 38 10h20q10 0 13 7l8 18 3 15q1 10-8 12H22q-9-2-8-12z"
        fill={`url(#${car})`}
        stroke="#fce4a7"
        strokeWidth={2}
      />
      <Path
        d="M29 18q3-3 9-3h20q6 0 9 3l6 18H23z"
        fill={`url(#${glass})`}
        stroke="#b57729"
        strokeWidth={2}
      />
      <Path d="M14 41q34 9 68 0" fill="none" stroke="#ffda79" strokeWidth={2} />
      <Circle cx="27" cy="48" r="8" fill="#fff8d7" />
      <Circle cx="69" cy="48" r="8" fill="#fff8d7" />
      <Circle cx="27" cy="48" r="4" fill="#182027" />
      <Circle cx="69" cy="48" r="4" fill="#182027" />
      <Path
        d="M39 53q9 6 18 0"
        stroke="#283039"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <Rect x="18" y="58" width="15" height="7" rx="3" fill="#1c2025" />
      <Rect x="63" y="58" width="15" height="7" rx="3" fill="#1c2025" />
    </Svg>
  );
}
