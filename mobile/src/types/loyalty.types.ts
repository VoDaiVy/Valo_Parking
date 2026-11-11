export type VoucherStatus = 'available' | 'used' | 'expired' | 'revoked';

export interface UserVoucher {
  _id: string;
  status: VoucherStatus;
  bookingId?: string | null;
  expiresAt: string;
  source?: string;
  benefitSnapshot: {
    name: string;
    type: 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT' | 'FREE_SERVICE';
    discountAmount?: number;
    discountPercent?: number;
    minimumAmount: number;
    serviceId?: { _id: string; name: string } | string | null;
  };
}

export interface SpendingProgress {
  month: string;
  total: number;
  enabled: boolean;
  highestAwardedThreshold: number;
  tiers: Array<{ threshold: number; discountAmount: number; minimumAmount: number }>;
}
