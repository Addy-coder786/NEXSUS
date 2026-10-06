import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDto, SendMessageInput } from '@nexus/shared';
import { chatKeys } from '../keys';
import { useSendMessage, type MessagesData } from '../hooks';
import { makeMessage, makeUserDto } from './fixtures';
import { attachRealtimeBridge } from '@/features/realtime/bridge';
import { FakeSocket } from '@/features/realtime/__tests__/fakeSocket';
import { useAuthStore } from '@/stores/auth.store';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@/features/chat/api', () => ({ chatApi: { send: sendMock } }));
vi.mock('@/lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false } }));

/** The messages cache has no observer in these hook tests, so it must not be garbage-collected between awaits. */
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

describe('useSendMessage (optimistic)', () => {
  it('inserts a pending message by clientId, replaces it with the server message and ignores the socket echo', async () => {
    const me = makeUserDto({ name: 'Me' });
    useAuthStore.setState({ user: me, status: 'authed' });
    const queryClient = makeQueryClient();
    const channelId = 'ch1';
    const existing = makeMessage({ channelId, body: 'earlier' });
    queryClient.setQueryData<MessagesData>(chatKeys.messages(channelId), { pages: [[existing]], pageParams: [undefined] });

    let resolveSend: (m: MessageDto) => void = () => undefined;
    sendMock.mockImplementation(
      (_id: string, input: SendMessageInput) =>
        new Promise<MessageDto>((resolve) => {
          resolveSend = (m) => resolve({ ...m, body: input.body, clientId: input.clientId ?? null });
        }),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSendMessage(channelId), { wrapper });

    act(() => {
      result.current.mutate({ clientId: 'client-1', body: 'hello' });
    });

    const pages = () => queryClient.getQueryData<MessagesData>(chatKeys.messages(channelId))?.pages[0] ?? [];
    await waitFor(() => expect(pages()).toHaveLength(2));
    expect(pages()[0]).toMatchObject({ clientId: 'client-1', body: 'hello', pending: true, author: { id: me.id } });
    expect(pages()[1]?.id).toBe(existing.id);

    const server = makeMessage({ channelId, author: { ...me }, body: 'hello', clientId: 'client-1' });
    act(() => resolveSend(server));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(pages()).toHaveLength(2);
    expect(pages()[0]).toMatchObject({ id: server.id, clientId: 'client-1' });
    expect(pages()[0]?.pending).toBeFalsy();

    // The realtime echo for the same message must not duplicate it.
    const socket = new FakeSocket();
    attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => me.id });
    act(() => socket.serverEmit('message:new', { ...server, body: 'hello' }));
    expect(pages()).toHaveLength(2);
    expect(pages().map((m) => m.id)).toEqual([server.id, existing.id]);
  });

  it('marks the optimistic message as failed when the request errors', async () => {
    useAuthStore.setState({ user: makeUserDto(), status: 'authed' });
    const queryClient = makeQueryClient();
    queryClient.setQueryData<MessagesData>(chatKeys.messages('ch2'), { pages: [[]], pageParams: [undefined] });
    sendMock.mockRejectedValueOnce(new Error('boom'));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSendMessage('ch2'), { wrapper });
    act(() => {
      result.current.mutate({ clientId: 'client-2', body: 'will fail' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const first = queryClient.getQueryData<MessagesData>(chatKeys.messages('ch2'))?.pages[0]?.[0];
    expect(first).toMatchObject({ clientId: 'client-2', failed: true, pending: false });
  });
});
