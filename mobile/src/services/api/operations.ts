import { apiClient } from './client';
import type { APIResponse } from '@/types/api';

export interface SlotAuditLog {
  _id: string;
  slotCode: string;
  detectedPlate?: string;
  expectedPlate?: string;
  status: string;
  changeType: string;
  violationMessage?: string;
  resolutionNote?: string;
  createdAt: string;
  floorId?: string | { _id: string; name?: string };
}

export interface NotificationRule {
  eventKey: string;
  name: string;
  group: string;
  enabled: boolean;
  channels: string[];
  throttleMinutes: number;
}

export const operationsService = {
  getViolations: (params: { page: number; status?: string; search?: string }) =>
    apiClient.get<APIResponse<SlotAuditLog[]> & { totalPages: number }>('/ai/violation-logs', {
      params: { ...params, limit: 20 },
    }),
  getSlotLogs: (slotCode: string, floorId: string) =>
    apiClient.get<APIResponse<SlotAuditLog[]>>(`/ai/slot-logs/${encodeURIComponent(slotCode)}`, {
      params: { floorId },
    }),
  resolveViolation: (data: {
    logId: string;
    slotCode: string;
    floorId?: string;
    action: 'ISSUE_WARNING';
    note: string;
  }) => apiClient.post<APIResponse>('/ai/resolve-violation', data),
  startMaintenance: (slotID: string, reason: string) =>
    apiClient.post<APIResponse>('/maintenance/start', { slotID, reason }),
  endMaintenance: (slotID: string) => apiClient.post<APIResponse>('/maintenance/end', { slotID }),
  getRules: () => apiClient.get<APIResponse<NotificationRule[]>>('/notifications/admin/rules'),
  updateRule: (
    eventKey: string,
    data: Pick<NotificationRule, 'enabled' | 'channels' | 'throttleMinutes'>,
  ) =>
    apiClient.put<APIResponse<NotificationRule>>(
      `/notifications/admin/rules/${encodeURIComponent(eventKey)}`,
      data,
    ),
};
