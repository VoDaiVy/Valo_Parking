export type FeedbackCategory = 'parking' | 'staff' | 'payment' | 'app' | 'other';

export interface BookingFeedback {
  _id: string;
  bookingId: string;
  rating: number;
  comment: string;
  categories: FeedbackCategory[];
  createdAt: string;
  reply: { content: string; repliedAt: string; updatedAt: string } | null;
  replyRevision: number;
}

export interface CreateFeedbackRequest {
  rating: number;
  comment: string;
  categories: FeedbackCategory[];
}

export interface FeedbackSummary {
  id: string;
  rating: number;
  hasReply: boolean;
}
