import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import type { MessageActions } from '../components/MessageItem';
import { makeMessage, minutesAgo } from './fixtures';
import { makeUser, renderWithProviders } from '@/test/utils';

vi.mock('@/lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false } }));

const actions: MessageActions = {
  canReact: true,
  canManage: false,
  mentionNames: [],
  myId: 'me',
  myName: 'Me',
  showThreadActions: true,
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleReaction: vi.fn(),
};

const listProps = { isLoading: false, hasMore: false, isFetchingMore: false, onLoadMore: vi.fn(), actions };

describe('MessageList', () => {
  it('groups consecutive messages by the same author within five minutes', () => {
    const alice = makeUser({ name: 'Alice Smith' });
    const bob = makeUser({ name: 'Bob Jones' });
    const now = Date.now();
    const messages = [
      makeMessage({ author: alice, body: 'first', createdAt: minutesAgo(10, now) }),
      makeMessage({ author: alice, body: 'second', createdAt: minutesAgo(9, now) }),
      makeMessage({ author: alice, body: 'much later', createdAt: minutesAgo(2, now) }),
      makeMessage({ author: bob, body: 'hello', createdAt: minutesAgo(1, now) }),
    ];
    renderWithProviders(<MessageList messages={messages} {...listProps} />);

    const items = screen.getAllByTestId('message-item');
    expect(items).toHaveLength(4);
    // Author headers appear only at the start of each group: Alice (x2 groups) + Bob.
    expect(screen.getAllByText('Alice Smith')).toHaveLength(2);
    expect(screen.getAllByText('Bob Jones')).toHaveLength(1);
    // The grouped continuation has no avatar/header but still shows its body.
    expect(within(items[1] as HTMLElement).queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('second')).toBeInTheDocument();
    // A single day separator for today.
    expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument();
  });

  it('renders the "New messages" divider before the first unread message from someone else', () => {
    const alice = makeUser({ name: 'Alice' });
    const now = Date.now();
    const read = makeMessage({ author: alice, body: 'old', createdAt: minutesAgo(30, now) });
    const mine = makeMessage({ author: makeUser({ id: 'me', name: 'Me' }), body: 'mine', createdAt: minutesAgo(4, now) });
    const fresh = makeMessage({ author: alice, body: 'fresh', createdAt: minutesAgo(3, now) });
    renderWithProviders(<MessageList messages={[read, mine, fresh]} lastReadAt={minutesAgo(5, now)} {...listProps} />);

    const divider = screen.getByTestId('new-messages-divider');
    const freshItem = screen.getByText('fresh').closest('[data-testid="message-item"]') as HTMLElement;
    const mineItem = screen.getByText('mine').closest('[data-testid="message-item"]') as HTMLElement;
    expect(divider.compareDocumentPosition(freshItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mineItem.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('new-messages-divider')).toHaveLength(1);
  });

  it('shows deleted, edited and Slack states', () => {
    const messages = [
      makeMessage({ body: '', deletedAt: new Date().toISOString() }),
      makeMessage({ body: 'fixed typo', editedAt: new Date().toISOString() }),
      makeMessage({ author: null, externalAuthor: { name: 'Slack Sam', avatarUrl: null }, source: 'slack', body: 'from slack' }),
    ];
    renderWithProviders(<MessageList messages={messages} {...listProps} />);
    expect(screen.getByText('This message was deleted.')).toBeInTheDocument();
    expect(screen.getByText('(edited)')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('Slack Sam')).toBeInTheDocument();
  });
});
