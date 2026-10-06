import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PRESENCE_TTL_SEC, type NotificationDto } from '@nexus/shared';
import { bindSocketToAuth, socket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import { attachRealtimeBridge } from './bridge';
import { isViewingLink, navigateTo } from './navigation';
import { usePresenceStore } from './presence.store';
import { chatKeys } from '@/features/chat/keys';
import { notificationKeys } from '@/features/notifications/keys';

function showNotificationToast(n: NotificationDto): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && n.link && isViewingLink(n.link)) return;
  const link = n.link;
  toast(n.title, {
    description: n.body ?? undefined,
    action: link ? { label: 'Open', onClick: () => navigateTo(link) } : undefined,
  });
}

/**
 * Mounts the realtime socket for the session, bridges server events into the query cache and
 * keeps presence alive. Must be rendered inside QueryClientProvider.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const detach = attachRealtimeBridge(socket, {
      queryClient,
      getCurrentUserId: () => useAuthStore.getState().user?.id ?? null,
      onNotification: showNotificationToast,
    });

    // After a reconnect the caches may have missed events; refetch what realtime normally keeps fresh.
    let hadConnection = false;
    const onConnect = () => {
      if (hadConnection) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.all });
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      }
      hadConnection = true;
    };
    const onDisconnect = () => usePresenceStore.getState().reset();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unbind = bindSocketToAuth();
    return () => {
      detach();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unbind();
    };
  }, [queryClient]);

  // Presence heartbeat + away state from tab visibility.
  useEffect(() => {
    const ping = () => {
      if (socket.connected) socket.emit('presence:ping');
    };
    const interval = setInterval(ping, Math.max(15, Math.floor(PRESENCE_TTL_SEC / 2)) * 1000);
    const onVisibility = () => {
      if (!socket.connected) return;
      socket.emit('presence:away', document.visibilityState === 'hidden');
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <>{children}</>;
}
