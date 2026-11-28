import { defaultFormatter, parseAnimatedNumber, useCountUp } from './numberAnimation';

export default function AnimatedNumber({ value, duration = 650, formatter, disabled = false }) {
  const parsed = parseAnimatedNumber(value);
  const display = useCountUp(parsed?.target ?? 0, { duration: disabled ? 0 : duration, formatter: formatter || parsed?.format || defaultFormatter });
  return parsed ? display : value;
}
