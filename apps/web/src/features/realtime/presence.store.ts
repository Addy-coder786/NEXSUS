import { create } from 'zustand';
import type { PresenceStatus } from '@nexus/shared';

interface PresenceState {
  /** Users currently online or away (anything but offline). */
  online: Set<string>;
  /** Last known status per user; missing means offline. */
  status: Record<string, PresenceStatus>;
  lastSeenAt: Record<string, string>;
  /** Replaces the online list for one workspace (sent by the server on connect). */
  setSnapshot: (workspaceId: string, online: string[]) => void;
  update: (p: { userId: string; status: PresenceStatus; lastSeenAt: string }) => void;
  reset: () => void;
}

function deriveOnline(status: Record<string, PresenceStatus>): Set<string> {
  const set = new Set<string>();
  for (const [id, s] of Object.entries(status)) if (s !== 'offline') set.add(id);
  return set;
}

/** Users seen in each workspace snapshot, so a later snapshot can mark the missing ones offline. */
const snapshotMembers: Record<string, string[]> = {};

export const usePresenceStore = create<PresenceState>((set) => ({
  online: new Set<string>(),
  status: {},
  lastSeenAt: {},
  setSnapshot: (workspaceId, online) =>
    set((state) => {
      const status = { ...state.status };
      for (const id of snapshotMembers[workspaceId] ?? []) {
        if (!online.includes(id)) status[id] = 'offline';
      }
      for (const id of online) {
        if (status[id] !== 'away') status[id] = 'online';
      }
      snapshotMembers[workspaceId] = online;
      return { status, online: deriveOnline(status) };
    }),
  update: ({ userId, status, lastSeenAt }) =>
    set((state) => {
      const next = { ...state.status, [userId]: status };
      return { status: next, online: deriveOnline(next), lastSeenAt: { ...state.lastSeenAt, [userId]: lastSeenAt } };
    }),
  reset: () => {
    for (const key of Object.keys(snapshotMembers)) delete snapshotMembers[key];
    set({ online: new Set<string>(), status: {}, lastSeenAt: {} });
  },
}));

/** Presence status for a user, `offline` when unknown. */
export function usePresence(userId: string | null | undefined): PresenceStatus {
  return usePresenceStore((s) => (userId ? (s.status[userId] ?? 'offline') : 'offline'));
}
