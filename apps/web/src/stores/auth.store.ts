import { create } from 'zustand';
import type { UserDto } from '@nexus/shared';

export type AuthStatus = 'idle' | 'loading' | 'authed' | 'anon';

interface AuthState {
  user: UserDto | null;
  status: AuthStatus;
  setUser: (user: UserDto) => void;
  setStatus: (status: AuthStatus) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'idle',
  setUser: (user) => set({ user, status: 'authed' }),
  setStatus: (status) => set({ status }),
  clear: () => set({ user: null, status: 'anon' }),
}));
