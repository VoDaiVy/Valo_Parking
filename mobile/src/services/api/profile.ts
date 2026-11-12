import type {
  APIResponse,
  ChangePasswordRequest,
  UpdateProfileRequest,
  UploadAvatarResponse,
} from '@/types/api';
import type { UserProfile } from '@/types/models';

import { apiClient } from './client';

class ProfileService {
  getPasswordStatus() {
    return apiClient.get<APIResponse<{ isGoogleUser: boolean }>>('/profile');
  }

  getProfile() {
    return apiClient.get<APIResponse<{ id: string; profile: UserProfile }>>('/profile');
  }

  updateProfile(data: UpdateProfileRequest) {
    return apiClient.put<APIResponse<UserProfile>>('/profile', data);
  }

  changePassword(data: ChangePasswordRequest) {
    return apiClient.put<APIResponse>('/profile/change-password', data);
  }

  uploadAvatar(file: { uri: string; name: string; type: string }) {
    const formData = new FormData();
    formData.append('avatar', file as unknown as Blob);

    return apiClient.post<UploadAvatarResponse>('/profile/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
}

export const profileService = new ProfileService();
