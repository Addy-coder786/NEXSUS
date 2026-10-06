import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SessionDto,
  UserDto,
} from '@nexus/shared';
import { api, API_BASE } from '@/lib/api';

export interface OAuthProviders {
  google: boolean;
  slack: boolean;
}

export const authApi = {
  me: () => api.get<UserDto>('/auth/me'),
  login: (input: LoginInput) => api.post<{ user: UserDto }>('/auth/login', input),
  register: (input: RegisterInput) => api.post<{ user: UserDto }>('/auth/register', input),
  logout: () => api.post<void>('/auth/logout'),
  logoutAll: () => api.post<void>('/auth/logout-all'),
  refresh: () => api.post<{ user: UserDto }>('/auth/refresh'),
  forgotPassword: (input: ForgotPasswordInput) => api.post<void>('/auth/forgot-password', input),
  resetPassword: (input: ResetPasswordInput) => api.post<void>('/auth/reset-password', input),
  verifyEmail: (token: string) => api.post<{ user: UserDto }>('/auth/verify-email', { token }),
  resendVerification: () => api.post<void>('/auth/resend-verification'),
  sessions: () => api.get<SessionDto[]>('/auth/sessions'),
  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
  providers: () => api.get<OAuthProviders>('/auth/providers'),
};

/** Absolute URL that starts the OAuth dance for `provider`, returning the user to `redirect`. */
export function oauthStartUrl(provider: 'google' | 'slack', redirect: string): string {
  const params = new URLSearchParams({ redirect });
  return `${API_BASE}/auth/${provider}?${params.toString()}`;
}
