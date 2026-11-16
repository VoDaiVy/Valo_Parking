import { apiClient } from './client';
import type { APIResponse } from '@/types/api';
import type { ExplorePackageCatalog, TicketPackageType } from '@/types/ticketPackage.types';

export const ticketPackagesService = {
  getExplore: (options: { type?: TicketPackageType | 'all'; page?: number; limit?: number; signal?: AbortSignal } = {}) => {
    const { type, page = 1, limit = 12, signal } = options;
    return apiClient.get<APIResponse<ExplorePackageCatalog>>('/ticket-packages/explore', {
      params: { page, limit, ...(type && type !== 'all' ? { type } : {}) },
      signal,
    });
  },
};
