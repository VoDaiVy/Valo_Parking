import { apiClient } from './client';
import type { APIResponse } from '@/types/api';
import type { SpendingProgress, UserVoucher, VoucherStatus } from '@/types/loyalty.types';

export const loyaltyService = {
  getVouchers: (status?: VoucherStatus) =>
    apiClient.get<APIResponse<UserVoucher[]>>('/loyalty/vouchers', { params: { status } }),
  getSpending: () => apiClient.get<APIResponse<SpendingProgress>>('/loyalty/spending'),
};
