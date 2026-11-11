import type { AiBookingDraft } from '@/services/api/assistant';

export function getAiBookingRange(draft: AiBookingDraft) {
  const parse = (date: unknown, time: unknown) => {
    if (
      typeof date !== 'string' ||
      typeof time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    )
      return null;
    const value = new Date(`${date}T${time}:00+07:00`);
    const day = new Date(`${date}T12:00:00Z`);
    return Number.isFinite(value.getTime()) &&
      Number.isFinite(day.getTime()) &&
      day.toISOString().slice(0, 10) === date
      ? value
      : null;
  };
  const start = parse(draft.startDate, draft.startTime);
  const end = parse(draft.endDate || draft.startDate, draft.endTime);
  if (!start || !end || end <= start || end.getTime() - start.getTime() < 30 * 60_000) return null;
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}
