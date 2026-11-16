import type { APIResponse } from '@/types/api';
import { apiClient } from './client';

export interface TelegramLinkStatus {
  linked: boolean;
  notificationsEnabled: boolean;
  username?: string;
  linkedAt?: string;
}
export const telegramService = {
  status: () => apiClient.get<APIResponse<TelegramLinkStatus>>('/telegram/link'),
  link: (bookingId?: string) => apiClient.post<APIResponse<{ deepLink: string; expiresAt: string }>>('/telegram/link-token', { bookingId }),
  preferences: (notificationsEnabled: boolean) => apiClient.patch<APIResponse<TelegramLinkStatus>>('/telegram/preferences', { notificationsEnabled }),
  unlink: () => apiClient.delete<APIResponse<unknown>>('/telegram/link'),
};
