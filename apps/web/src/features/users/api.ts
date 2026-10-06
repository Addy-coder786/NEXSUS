import type {
  ChangePasswordInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
  UserDto,
  UserPublicDto,
} from '@nexus/shared';
import { api } from '@/lib/api';

export const usersApi = {
  me: () => api.get<UserDto>('/users/me'),
  updateProfile: (input: UpdateProfileInput) => api.patch<UserDto>('/users/me', input),
  updatePreferences: (input: UpdatePreferencesInput) => api.patch<UserDto>('/users/me/preferences', input),
  changePassword: (input: ChangePasswordInput) => api.patch<void>('/users/me/password', input),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<UserDto>('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  removeAvatar: () => api.delete<UserDto>('/users/me/avatar'),
  get: (id: string) => api.get<UserPublicDto>(`/users/${id}`),
};
