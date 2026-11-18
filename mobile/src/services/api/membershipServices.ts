import type { APIResponse } from '@/types/api';
import { apiClient } from './client';

export interface MembershipServiceWork {
  _id: string;
  serviceId: string;
  serviceName: string;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  accountingMode?: string;
}

export interface MembershipServiceChoice {
  serviceId: string;
  serviceName: string;
  available: number;
  reserved: number;
  nearestExpiry?: string | null;
}

export interface SessionServiceBenefits {
  session: { _id: string; status: string; licensePlate: string; parkingSlot?: string; floorName?: string };
  groupedBenefits: MembershipServiceChoice[];
  requests: MembershipServiceWork[];
  revision: number;
  selectionEnabled: boolean;
}

export const membershipServices = {
  benefits: (sessionId: string) => apiClient.get<APIResponse<SessionServiceBenefits>>(
    `/membership-services/sessions/${encodeURIComponent(sessionId)}/benefits`,
  ),
  select: (sessionId: string, payload: { serviceIds: string[]; revision: number; idempotencyKey: string }) =>
    apiClient.put<APIResponse>(`/membership-services/sessions/${encodeURIComponent(sessionId)}/selection`, payload),
};

export function pendingServiceIds(data: SessionServiceBenefits) {
  return data.requests.filter((work) => work.status === 'pending' && work.accountingMode === 'customer_reserved')
    .map((work) => work.serviceId);
}

export function membershipServiceChoices(data: SessionServiceBenefits) {
  const choices = [...data.groupedBenefits];
  for (const work of data.requests) {
    if (work.status === 'pending' && work.accountingMode === 'customer_reserved' && !choices.some((choice) => choice.serviceId === work.serviceId)) {
      choices.push({ serviceId: work.serviceId, serviceName: work.serviceName, available: 0, reserved: 1 });
    }
  }
  return choices;
}
