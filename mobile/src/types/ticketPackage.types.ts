import type { SubscriptionPackage } from './subscription.types';

export type TicketPackageType = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface ExploreTicketPackage {
  _id: string;
  name: string;
  type: TicketPackageType;
  price: number;
  description?: string;
  isActive: boolean;
  maxSlots?: number;
  benefits?: string[];
  durationDays?: number;
  durationMinutes?: number;
  durationMonths?: number;
  duration?: SubscriptionPackage['duration'];
  service?: SubscriptionPackage['service'];
  salesAvailability?: { available: boolean; message: string };
  selectionReason?: 'bestseller' | 'recommended';
}

export interface ExplorePackageCatalog {
  featured: ExploreTicketPackage[];
  items: ExploreTicketPackage[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  rankingWindow: { from: string; to: string; days: number };
  generatedAt: string;
}
