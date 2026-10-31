import { useEffect, useState } from 'react';

// Presentation clock only; does not change scheduler cadence or request data.
export function useMembershipClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
