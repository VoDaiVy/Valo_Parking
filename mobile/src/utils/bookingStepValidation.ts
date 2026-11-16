import { normalizeLicensePlate } from './profileValidation';

export function validateBookingTime(start: Date, end: Date, now = Date.now()): string {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 'Choose valid arrival and departure times.';
  if (start.getTime() <= now) return 'Arrival must be in the future.';
  if (end.getTime() - start.getTime() < 30 * 60_000) return 'Parking duration must be at least 30 minutes.';
  return '';
}

export function validateBookingVehicle(selectedId: string | null, manualPlate: string, savedVehicleExists: boolean): string {
  if (!selectedId) return 'Select a vehicle or enter another license plate.';
  if (selectedId !== 'manual') return savedVehicleExists ? '' : 'Select an available vehicle from your account.';
  if (!manualPlate.trim()) return 'Enter your license plate.';
  return /^[1-9]\d[A-Z]{1,2}\d{4,5}$/.test(normalizeLicensePlate(manualPlate))
    ? '' : 'Enter a valid car plate, for example 43A - 123.45.';
}

export function firstInvalidBookingStep(errors: readonly string[], target: number): number {
  for (let index = 0; index < target; index += 1) if (errors[index]) return index;
  return target;
}
