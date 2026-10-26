import { apiClient } from './client';
import type { APIResponse } from '@/types/api';
import type { StaffSession } from './staff';

export const sessionsService = {
  getActiveParkingStatus: () => apiClient.get('/sessions/active-status'),
  getAllSessions: () => apiClient.get('/sessions'),
  getMyHistory: () => apiClient.get('/sessions/my-history'),
  reassignSlot: (sessionId: string, data: { newSlotCode: string; floorId: string; reason: string }) =>
    apiClient.post<APIResponse<StaffSession>>(`/sessions/${sessionId}/reassign-slot`, data),
  getExitQuote: (licensePlate: string) => apiClient.post<APIResponse<{
    session: StaffSession; totalPrice: number; amountToPay: number; refundAmount: number;
  }>>('/sessions/kiosk-exit-scan', { licensePlate }),
  checkout: (sessionId: string, exitImageBase64: string, paymentMethod: 'CASH' | 'WALLET') =>
    apiClient.post<APIResponse<StaffSession>>('/sessions/kiosk-checkout', { sessionId, exitImageBase64, paymentMethod: paymentMethod === 'WALLET' ? 'wallet' : 'cash' }),
};
