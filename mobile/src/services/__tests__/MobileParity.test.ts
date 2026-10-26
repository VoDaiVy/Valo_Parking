import { apiClient } from '../api/client';
import { subscriptionsService } from '../api/subscriptions';
import { sessionsService } from '../api/sessions';
import { bookingService } from '../BookingService';

describe('web/mobile API contracts', () => {
  afterEach(() => jest.restoreAllMocks());
  it('uses the membership account endpoint and entitlement renewal verification endpoint', async () => {
    const get = jest.spyOn(apiClient, 'get').mockResolvedValue({ success: true });
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({ success: true });
    await subscriptionsService.getMembership();
    await subscriptionsService.verifyEntitlementRenewalPayment(123);
    expect(get).toHaveBeenCalledWith('/subscriptions/membership');
    expect(post).toHaveBeenCalledWith('/subscriptions/entitlements/renew/verify-payment', {
      orderCode: 123,
    });
  });
  it('requests the policy-based cancellation quote before showing a refund', async () => {
    const get = jest
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ success: true, data: { paidAmount: 50000, refundAmount: 15000 } });
    const response = await bookingService.getCancellationQuote('booking-1');
    expect(get).toHaveBeenCalledWith('/bookings/booking-1/cancel-quote');
    expect(response.data?.refundAmount).toBe(15000);
  });
  it('maps staff payment choices to the backend values instead of uppercase labels', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({ success: true });
    await sessionsService.checkout('session-1', 'photo', 'WALLET');
    await sessionsService.checkout('session-1', 'photo', 'CASH');
    expect(post).toHaveBeenNthCalledWith(1, '/sessions/kiosk-checkout', {
      sessionId: 'session-1',
      exitImageBase64: 'photo',
      paymentMethod: 'wallet',
    });
    expect(post).toHaveBeenNthCalledWith(2, '/sessions/kiosk-checkout', {
      sessionId: 'session-1',
      exitImageBase64: 'photo',
      paymentMethod: 'cash',
    });
  });
});
