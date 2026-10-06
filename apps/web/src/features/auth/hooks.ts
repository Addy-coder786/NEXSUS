import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '@nexus/shared';
import { authApi } from './api';
import { useAuthStore } from '@/stores/auth.store';

export const authKeys = {
  all: ['auth'] as const,
  providers: () => [...authKeys.all, 'providers'] as const,
  sessions: () => [...authKeys.all, 'sessions'] as const,
};

/** Loads the current user once on app start. 401 (after a failed refresh) resolves to `anon`. */
export function useBootstrapAuth(): void {
  const status = useAuthStore((s) => s.status);
  const setStatus = useAuthStore((s) => s.setStatus);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    if (status !== 'idle') return;
    setStatus('loading');
    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {
        // 401 (after a failed refresh), network errors and server errors all resolve to `anon`
        // so the app stays usable: the guard sends the visitor to the login page.
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [status, setStatus, setUser, clear]);
}

export function useLogin() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: ({ user }) => setUser(user),
  });
}

export function useRegister() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: ({ user }) => setUser(user),
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      clear();
      queryClient.clear();
    },
  });
}

export function useLogoutAll() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logoutAll(),
    onSettled: () => {
      clear();
      queryClient.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (input: ForgotPasswordInput) => authApi.forgotPassword(input) });
}

export function useResetPassword() {
  return useMutation({ mutationFn: (input: ResetPasswordInput) => authApi.resetPassword(input) });
}

export function useVerifyEmail() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (token: string) => authApi.verifyEmail(token),
    onSuccess: ({ user }) => setUser(user),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: () => authApi.resendVerification() });
}

export function useOAuthProviders() {
  return useQuery({
    queryKey: authKeys.providers(),
    queryFn: () => authApi.providers(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSessions() {
  return useQuery({ queryKey: authKeys.sessions(), queryFn: () => authApi.sessions() });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.sessions() }),
  });
}

/** Refreshes the user from the server (e.g. after returning from OAuth). */
export function useRefreshMe() {
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => authApi.me(),
    onSuccess: (user) => setUser(user),
    onError: () => clear(),
  });
}
