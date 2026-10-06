import { useMutation } from '@tanstack/react-query';
import type { ChangePasswordInput, UpdatePreferencesInput, UpdateProfileInput } from '@nexus/shared';
import { usersApi } from './api';
import { useAuthStore } from '@/stores/auth.store';

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => usersApi.updateProfile(input),
    onSuccess: (user) => setUser(user),
  });
}

export function useUpdatePreferences() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: UpdatePreferencesInput) => usersApi.updatePreferences(input),
    onSuccess: (user) => setUser(user),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (input: ChangePasswordInput) => usersApi.changePassword(input) });
}

export function useUploadAvatar() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (file: File) => usersApi.uploadAvatar(file),
    onSuccess: (user) => setUser(user),
  });
}

export function useRemoveAvatar() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: () => usersApi.removeAvatar(),
    onSuccess: (user) => setUser(user),
  });
}
