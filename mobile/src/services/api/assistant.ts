import { apiClient } from './client';
import type { APIResponse } from '@/types/api';

export interface AiBookingDraft extends Record<string, unknown> {
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  licensePlate?: string;
  floorName?: string;
  slotCode?: string;
  reservationItems?: AiBookingDraft[];
}

export interface AiBookingInterpretation {
  intent: string;
  draft: AiBookingDraft;
  clarification?: string;
  assistantResult?: { message?: string };
}

export interface CopilotReply {
  type: string;
  message: string;
  conversationId: string;
  evidence?: Array<{ label?: string; source?: string; summary?: string }>;
  draft?: {
    id?: string;
    _id?: string;
    type: string;
    status: string;
    summary?: string;
    reason?: string;
    current?: { username?: string; email?: string };
    payload?: Record<string, unknown>;
  } | null;
}

export const assistantService = {
  interpret: (prompt: string, draft: AiBookingDraft, today: string, currentTime: string) =>
    apiClient.post<APIResponse<AiBookingInterpretation>>('/ai/booking/interpret', {
      prompt,
      draft,
      today,
      currentTime,
    }),
  chat: (message: string, conversationId?: string) =>
    apiClient.post<APIResponse<CopilotReply>>('/ai-copilot/staff/chat', {
      message,
      conversationId,
    }),
  decideDraft: (id: string, decision: 'approve' | 'reject') =>
    apiClient.post<APIResponse>(`/ai-copilot/staff/drafts/${encodeURIComponent(id)}/${decision}`),
};
