import { apiClient } from '@/services/api/client';
import type { APIResponse } from '@/types/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
export type Profile = {
  _id: string;
  username: string;
  email: string;
  fullName?: string;
  phone?: string;
  avatar?: string;
  role: string;
  createdAt?: string;
  wallet?: {
    balance: number;
  };
};

type ProfileResponseData = {
  id?: string;
  _id?: string;
  username: string;
  email: string;
  role: string;
  createdAt?: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    avatar?: string;
  } | null;
  wallet?: { balance: number };
};

// ─── Endpoints ─────────────────────────────────────────────────────────────────
export const fetchProfile = async (): Promise<Profile> => {
  const response = await apiClient.get<APIResponse<ProfileResponseData>>('/profile');
  const d = response.data;

  if (!d) {
    throw new Error('Invalid profile data.');
  }

  const id = d.id || d._id;
  if (!id) {
    throw new Error('The profile does not contain a user ID.');
  }

  const firstName = d.profile?.firstName?.trim() || '';
  const lastName = d.profile?.lastName?.trim() || '';
  // Match the name order stored by registration/Google and shown on the web.
  const fullName = `${firstName} ${lastName}`.trim();
  
  return {
    _id: id,
    username: d.username,
    email: d.email,
    role: d.role,
    createdAt: d.createdAt,
    fullName: fullName || undefined,
    phone: d.profile?.phone,
    avatar: d.profile?.avatar,
    wallet: d.wallet,
  };
};
