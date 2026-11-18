import { staffService } from './api/staff';

// Only route credentials here. Signature, ownership and transition permissions
// are always verified by the backend.
export async function resolveStaffParkingQr(rawPayload: string) {
  const payload = rawPayload.trim();
  if (payload.startsWith('VALO_MEMBERSHIP:') || payload.startsWith('VALO_MEMBERSHIP_ACCOUNT:')) {
    return { payload, response: await staffService.resolveMembershipQr(payload) };
  }
  if (payload.startsWith('VALO_PASS:')) {
    return { payload, response: await staffService.resolveParkingPass(payload) };
  }
  if (payload.startsWith('VALO_BOOKING:')) {
    return { payload, response: await staffService.resolveBookingQr(payload) };
  }
  throw new Error('This is not a VALO booking or membership QR code.');
}
