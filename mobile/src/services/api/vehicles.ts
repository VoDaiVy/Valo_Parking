import type { APIResponse } from '@/types/api';
import type { CreateVehicleRequest, UpdateVehicleRequest, Vehicle } from '@/types/models';

import { apiClient } from './client';

export const MAX_VEHICLES_PER_USER = 3;

class VehiclesService {
  getMyVehicles() {
    return apiClient.get<APIResponse<Vehicle[]>>('/vehicles');
  }

  getVehicleById(id: string) {
    return apiClient.get<APIResponse<Vehicle>>(`/vehicles/${id}`);
  }

  addVehicle(data: CreateVehicleRequest) {
    return apiClient.post<APIResponse<Vehicle>>('/vehicles', data);
  }

  updateVehicle(id: string, data: UpdateVehicleRequest) {
    return apiClient.put<APIResponse<Vehicle>>(`/vehicles/${id}`, data);
  }

  deleteVehicle(id: string) {
    return apiClient.delete<APIResponse>(`/vehicles/${id}`);
  }

  setDefaultVehicle(id: string) {
    return apiClient.patch<APIResponse<Vehicle>>(`/vehicles/${id}/default`);
  }

  scanRegistrationCard(imageBase64: string) {
    return apiClient.post<APIResponse<{
      nickname: string | null;
      brand: string | null;
      model: string | null;
      licensePlate: string | null;
      colorText: string | null;
      hexColor: string | null;
    }>>('/ai/scan-registration-card', { image: imageBase64 });
  }
}

export const vehiclesService = new VehiclesService();
