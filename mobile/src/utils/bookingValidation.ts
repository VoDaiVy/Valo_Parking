import { formatCurrency } from './formatters';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const roundToNextHour = (date = new Date()) => {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);

  if (next <= date) {
    next.setHours(next.getHours() + 1);
  }

  return next;
};

export const getDefaultBookingRange = () => {
  const startTime = roundToNextHour();
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

  return { startTime, endTime };
};

export const calculateDurationHours = (startTime: Date, endTime: Date) =>
  Math.max(1, Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)));

export const formatDuration = (startTime: Date, endTime: Date) => {
  const durationMs = Math.max(0, endTime.getTime() - startTime.getTime());
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
};

export const validateTimeRange = (startTime: Date, endTime: Date): ValidationResult => {
  const now = new Date();

  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
    return { valid: false, error: 'Select a valid start and end time.' };
  }
  if (startTime < now) {
    return { valid: false, error: 'Start time cannot be in the past.' };
  }

  if (endTime <= startTime) {
    return { valid: false, error: 'End time must be after start time.' };
  }

  if (endTime.getTime() - startTime.getTime() < 30 * 60 * 1000) {
    return { valid: false, error: 'Minimum booking duration is 30 minutes.' };
  }

  return { valid: true };
};

export const validateWalletBalance = (balance: number, requiredAmount: number): ValidationResult => {
  if (balance < requiredAmount) {
    return {
      valid: false,
      error: `Insufficient balance. Required: ${formatCurrency(requiredAmount)}, Available: ${formatCurrency(balance)}.`,
    };
  }

  return { valid: true };
};
