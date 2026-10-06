import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Client-side chat view preferences. Mute state lives on the server (ChannelDto.muted). */
interface ChatPrefsState {
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
}

export const useChatPrefs = create<ChatPrefsState>()(
  persist(
    (set) => ({
      showArchived: false,
      setShowArchived: (showArchived) => set({ showArchived }),
    }),
    { name: 'nexus-chat', version: 2, migrate: (s) => ({ showArchived: Boolean((s as { showArchived?: boolean } | null)?.showArchived) }) },
  ),
);
