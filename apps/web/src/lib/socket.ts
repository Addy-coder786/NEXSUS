import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@nexus/shared';
import { API_URL, refreshSession } from './api';
import { useAuthStore, type AuthStatus } from '@/stores/auth.store';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function socketOrigin(): string {
  if (API_URL) return API_URL;
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
}

/**
 * Single realtime connection for the app. It never connects on its own: `bindSocketToAuth()`
 * (mounted by RealtimeProvider) connects when the session is authenticated and disconnects on logout.
 */
export const socket: AppSocket = io(socketOrigin(), {
  path: SOCKET_PATH,
  withCredentials: true,
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

function isUnauthorized(err: Error): boolean {
  const data = (err as Error & { data?: { code?: string } }).data;
  return err.message === 'UNAUTHORIZED' || data?.code === 'UNAUTHORIZED';
}

let refreshing: Promise<void> | null = null;
/** After a failed refresh we stop retrying until the next explicit `connectSocket()`. */
let refreshFailed = false;

socket.on('connect_error', (err) => {
  if (!isUnauthorized(err) || refreshing || refreshFailed) return;
  refreshing = refreshSession()
    .then(() => {
      if (useAuthStore.getState().status === 'authed') socket.connect();
    })
    .catch(() => {
      refreshFailed = true;
      socket.disconnect();
      useAuthStore.getState().clear();
    })
    .finally(() => {
      refreshing = null;
    });
});

socket.on('connect', () => {
  refreshFailed = false;
});

export function connectSocket(): void {
  refreshFailed = false;
  if (!socket.connected) socket.connect();
}

export function disconnectSocket(): void {
  if (socket.connected || socket.active) socket.disconnect();
}

/** Keeps the socket connected while the auth status is `authed`. Returns an unsubscribe function. */
export function bindSocketToAuth(): () => void {
  const apply = (status: AuthStatus) => {
    if (status === 'authed') connectSocket();
    else if (status === 'anon') disconnectSocket();
  };
  apply(useAuthStore.getState().status);
  return useAuthStore.subscribe((state, prev) => {
    if (state.status !== prev.status) apply(state.status);
  });
}
