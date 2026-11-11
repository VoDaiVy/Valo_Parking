const vietnamDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
});
const timestamp = (value) => value == null || value === '' ? NaN : new Date(value).getTime();

// GET /sessions returns the full authorized list. Never pass pagination.items.
export function sessionMetrics(sessions, now = new Date()) {
  const active = sessions.filter((session) => session.status === 'active');
  let needsAttention = 0;
  let missingTiming = false;
  for (const session of active) {
    const start = timestamp(session.checkInTime);
    const hours = session.expectedDurationHours;
    if (!Number.isFinite(start) || hours == null || hours === '' || !Number.isFinite(Number(hours))) {
      missingTiming = true;
      continue;
    }
    // Match Staff diagnostics: strictly past the recorded expected duration.
    if (start + Number(hours) * 3600000 < now.getTime()) needsAttention++;
  }
  return {
    total: sessions.length,
    parked: active.length,
    completedToday: sessions.filter((session) => {
      const end = timestamp(session.checkOutTime);
      return session.status === 'completed' && Number.isFinite(end)
        && vietnamDay.format(end) === vietnamDay.format(now);
    }).length,
    needsAttention: missingTiming ? null : needsAttention,
  };
}
