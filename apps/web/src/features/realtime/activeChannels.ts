/**
 * Channels currently open on screen (joined via `useChannelRoom`). The bridge uses this to ignore
 * `channel:unread` pushes for a conversation the user is already looking at.
 */
const active = new Map<string, number>();

export function markChannelActive(channelId: string): void {
  active.set(channelId, (active.get(channelId) ?? 0) + 1);
}

export function unmarkChannelActive(channelId: string): void {
  const n = (active.get(channelId) ?? 0) - 1;
  if (n <= 0) active.delete(channelId);
  else active.set(channelId, n);
}

export function isChannelActive(channelId: string): boolean {
  return active.has(channelId);
}
