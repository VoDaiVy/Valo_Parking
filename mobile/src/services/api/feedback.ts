import { apiClient } from './client';
import type { BookingFeedback, CreateFeedbackRequest } from '@/types/feedback.types';

type FeedbackResponse = { success: boolean; data: BookingFeedback | null };

export const feedbackService = {
  get: (bookingId: string) => apiClient.get<FeedbackResponse>(`/bookings/${bookingId}/feedback`),
  create: (bookingId: string, body: CreateFeedbackRequest) =>
    apiClient.post<FeedbackResponse>(`/bookings/${bookingId}/feedback`, body),
};
