import { apiClient } from './client';
import type { APIResponse } from '@/types/api';
import type {
  CreateSubscriptionPaymentRequest,
  CreateSubscriptionPaymentResponse,
  MembershipStatus,
  SubscriptionRenewalQuote,
  SubscriptionRenewalResult,
  SubscriptionPackage,
  MembershipEntitlementTransfer,
  CreateMembershipEntitlementTransferRequest,
  MembershipTransferClaimResult,
  MembershipTransferMarketplaceFilters,
  MembershipTransferMarketplaceList,
  MembershipTransferMarketplaceListing,
} from '@/types/subscription.types';

export const subscriptionsService = {
  getPackages: () => apiClient.get<APIResponse<SubscriptionPackage[]>>('/ticket-packages/active'),
  getMembership: () => apiClient.get<APIResponse<MembershipStatus>>('/users/membership'),
  getMembershipQr: (_subscriptionId?: string) =>
    apiClient.get<
      APIResponse<{
        available: boolean;
        membershipStatus: string;
        expireAt: string;
        payload: string | null;
        reason: string | null;
      }>
    >('/subscriptions/membership/qr'),
  createPayment: (data: CreateSubscriptionPaymentRequest) =>
    apiClient.post<CreateSubscriptionPaymentResponse>('/subscriptions/payment', data),
  verifyPayment: (data: { orderCode: number }) =>
    apiClient.post<APIResponse>('/subscriptions/verify-payment', data),
  payWithWallet: (data: CreateSubscriptionPaymentRequest) =>
    apiClient.post<APIResponse>('/subscriptions/pay-with-wallet', data),
  getRenewalQuote: (subscriptionId: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalQuote>>(
      `/subscriptions/${subscriptionId}/renew/quote`,
    ),
  renewWithWallet: (subscriptionId: string, idempotencyKey: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalResult>>(
      `/subscriptions/${subscriptionId}/renew/pay-with-wallet`,
      { idempotencyKey },
    ),
  createRenewalPayment: (subscriptionId: string, idempotencyKey: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalResult>>(
      `/subscriptions/${subscriptionId}/renew/create-payment`,
      { idempotencyKey },
    ),
  verifyRenewalPayment: (orderCode: number) =>
    apiClient.post<APIResponse<SubscriptionRenewalResult>>(
      '/subscriptions/renew/verify-payment',
      { orderCode },
    ),
  getEntitlementRenewalQuote: (entitlementId: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalQuote>>(
      `/subscriptions/entitlements/${entitlementId}/renew/quote`,
    ),
  renewEntitlementWithWallet: (entitlementId: string, idempotencyKey: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalResult>>(
      `/subscriptions/entitlements/${entitlementId}/renew/pay-with-wallet`,
      { idempotencyKey },
    ),
  createEntitlementRenewalPayment: (entitlementId: string, idempotencyKey: string) =>
    apiClient.post<APIResponse<SubscriptionRenewalResult>>(
      `/subscriptions/entitlements/${entitlementId}/renew/create-payment`,
      { idempotencyKey },
    ),
  createEntitlementTransfer: (
    entitlementId: string,
    data: CreateMembershipEntitlementTransferRequest,
  ) =>
    apiClient.post<APIResponse<MembershipEntitlementTransfer>>(
      `/customer/membership-entitlements/${entitlementId}/transfers`,
      data,
    ),
  getTransferMarketplace: (filters: MembershipTransferMarketplaceFilters = {}) =>
    apiClient.get<APIResponse<MembershipTransferMarketplaceList>>(
      '/customer/membership-transfer-marketplace',
      { params: filters },
    ),
  getTransferMarketplaceListing: (transferId: string) =>
    apiClient.get<APIResponse<MembershipTransferMarketplaceListing>>(
      `/customer/membership-transfer-marketplace/${transferId}`,
    ),
  claimTransferMarketplaceListing: (transferId: string) =>
    apiClient.post<APIResponse<MembershipTransferClaimResult>>(
      `/customer/membership-transfer-marketplace/${transferId}/claim`,
    ),
  getEntitlementTransfers: () =>
    apiClient.get<APIResponse<MembershipEntitlementTransfer[]>>(
      '/customer/membership-entitlement-transfers',
    ),
  acceptEntitlementTransfer: (transferId: string) =>
    apiClient.put<APIResponse<MembershipEntitlementTransfer>>(
      `/customer/membership-entitlement-transfers/${transferId}/accept`,
    ),
  rejectEntitlementTransfer: (transferId: string) =>
    apiClient.put<APIResponse<MembershipEntitlementTransfer>>(
      `/customer/membership-entitlement-transfers/${transferId}/reject`,
      { reason: 'Declined by customer' },
    ),
  settleEntitlementTransfer: (transferId: string) =>
    apiClient.post<APIResponse<MembershipEntitlementTransfer>>(
      `/customer/membership-entitlement-transfers/${transferId}/settle-wallet`,
    ),
  cancelEntitlementTransfer: (transferId: string) =>
    apiClient.put<APIResponse<MembershipEntitlementTransfer>>(
      `/customer/membership-entitlement-transfers/${transferId}/cancel`,
    ),
};
