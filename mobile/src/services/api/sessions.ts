import { apiClient } from './client';
import type { APIResponse } from '@/types/api';
import type { StaffSession, PackageParkingQuote } from './staff';

export interface CheckoutBankPayment { checkoutAttemptId: string; orderCode: number; amountDue: number; qrCode: string; checkoutUrl: string; pricingBreakdown?: PackageParkingQuote; }
export type CheckoutResponse = { success: boolean; requiresPayment: true; data: CheckoutBankPayment } | { success: boolean; requiresPayment?: false; data: StaffSession };

export const sessionsService = {
  getActiveParkingStatus: () => apiClient.get('/sessions/active-status'),
  getAllSessions: () => apiClient.get('/sessions'),
  getMyHistory: () => apiClient.get('/sessions/my-history'),
  reassignSlot: (sessionId: string, data: { newSlotCode: string; floorId: string; reason: string }) =>
    apiClient.post<APIResponse<StaffSession>>(`/sessions/${sessionId}/reassign-slot`, data),
  getExitQuote: (licensePlate: string) => apiClient.post<APIResponse<{
    session: StaffSession; totalPrice: number; amountToPay: number; refundAmount: number; pricingBreakdown?: PackageParkingQuote;
  }>>('/sessions/kiosk-exit-scan', { licensePlate }),
  checkout: (sessionId: string, exitImageBase64: string, paymentMethod: 'CASH' | 'WALLET' | 'BANK' | 'QR', expectedAmount?: number, checkoutAttemptId?: string) =>
    apiClient.post<CheckoutResponse>('/sessions/kiosk-checkout', { sessionId, exitImageBase64, expectedAmount, checkoutAttemptId, paymentMethod: { CASH: 'cash', WALLET: 'wallet', BANK: 'vietqr', QR: 'qr' }[paymentMethod] }),
};
