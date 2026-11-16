import type { MembershipStatus } from '@/types/subscription.types';

export type MembershipVisualTier = 'standard' | 'monthly' | 'yearly';

export const MEMBERSHIP_TIER_COLORS: Record<MembershipVisualTier, {
  accent: string;
  avatarBackground: string;
  avatarText: string;
}> = {
  standard: { accent: '#94A3B8', avatarBackground: '#25282D', avatarText: '#F8FAFC' },
  monthly: { accent: '#D4AF37', avatarBackground: '#8A721F', avatarText: '#090909' },
  yearly: { accent: '#A855F7', avatarBackground: '#2D173F', avatarText: '#F5E9FF' },
};

export const getMembershipVisualTier = (
  membership: Pick<MembershipStatus, 'isVip' | 'status' | 'package'> | null | undefined,
): MembershipVisualTier => {
  if (!membership?.isVip || membership.status !== 'active') return 'standard';
  if (membership.package?.type === 'yearly') return 'yearly';
  if (membership.package?.type === 'monthly') return 'monthly';
  return 'standard';
};

export const getMembershipTierLabel = (tier: MembershipVisualTier) => {
  if (tier === 'yearly') return 'Annual member';
  if (tier === 'monthly') return 'Monthly member';
  return 'Customer';
};
