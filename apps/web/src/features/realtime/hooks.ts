import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPING_TTL_MS } from '@nexus/shared';
import { socket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import { markChannelActive, unmarkChannelActive } from './activeChannels';

export { usePresence, usePresenceStore } from './presence.store';

/** Join a room while mounted and re-join after every reconnect. */
function useRoom(kind: 'project' | 'channel', id: string | null | undefined): void {
  useEffect(() => {
    if (!id) return;
    const join = () => {
      if (kind === 'project') socket.emit('project:join', id);
      else socket.emit('channel:join', id);
    };
    if (kind === 'channel') markChannelActive(id);
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      if (kind === 'channel') unmarkChannelActive(id);
      socket.off('connect', join);
      if (socket.connected) {
        if (kind === 'project') socket.emit('project:leave', id);
        else socket.emit('channel:leave', id);
      }
    };
  }, [kind, id]);
}

export function useProjectRoom(projectId: string | null | undefined): void {
  useRoom('project', projectId);
}

export function useChannelRoom(channelId: string | null | undefined): void {
  useRoom('channel', channelId);
}

export interface TypingUser {
  userId: string;
  name: string;
}

/** Interval between repeated `typing:start` emits while the user keeps typing. */
const TYPING_THROTTLE_MS = 2500;
/** Idle time after the last keystroke before `typing:stop` is sent. */
const TYPING_IDLE_MS = 3000;

/**
 * Typing indicator for a channel: `typingUsers` is who else is typing (auto-expires after TYPING_TTL_MS);
 * call `onInput()` on every keystroke and `stop()` when a message is sent.
 */
export function useTyping(channelId: string | null | undefined): {
  typingUsers: TypingUser[];
  onInput: () => void;
  stop: () => void;
} {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastStart = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typing = useRef(false);

  useEffect(() => {
    setTypingUsers([]);
    if (!channelId) return;
    const timerMap = timers.current;
    const handler = (p: { channelId: string; userId: string; name: string; isTyping: boolean }) => {
      if (p.channelId !== channelId || p.userId === myId) return;
      const existing = timerMap.get(p.userId);
      if (existing) clearTimeout(existing);
      if (!p.isTyping) {
        timerMap.delete(p.userId);
        setTypingUsers((prev) => prev.filter((u) => u.userId !== p.userId));
        return;
      }
      timerMap.set(
        p.userId,
        setTimeout(() => {
          timerMap.delete(p.userId);
          setTypingUsers((prev) => prev.filter((u) => u.userId !== p.userId));
        }, TYPING_TTL_MS),
      );
      setTypingUsers((prev) =>
        prev.some((u) => u.userId === p.userId) ? prev : [...prev, { userId: p.userId, name: p.name }],
      );
    };
    socket.on('typing', handler);
    return () => {
      socket.off('typing', handler);
      for (const t of timerMap.values()) clearTimeout(t);
      timerMap.clear();
    };
  }, [channelId, myId]);

  const stop = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (typing.current && channelId && socket.connected) socket.emit('typing:stop', channelId);
    typing.current = false;
    lastStart.current = 0;
  }, [channelId]);

  const onInput = useCallback(() => {
    if (!channelId || !socket.connected) return;
    const now = Date.now();
    if (!typing.current || now - lastStart.current > TYPING_THROTTLE_MS) {
      socket.emit('typing:start', channelId);
      lastStart.current = now;
      typing.current = true;
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stop, TYPING_IDLE_MS);
  }, [channelId, stop]);

  // Send a final stop when the channel changes or the composer unmounts.
  useEffect(() => stop, [stop]);

  return { typingUsers, onInput, stop };
}
