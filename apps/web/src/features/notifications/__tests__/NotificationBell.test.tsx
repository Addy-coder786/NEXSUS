import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '@nexus/shared';
import { NotificationBell } from '../components/NotificationBell';
import { makeNotification, makeUserDto } from '@/features/chat/__tests__/fixtures';
import { useAuthStore } from '@/stores/auth.store';
import { renderWithProviders } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  unreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/features/notifications/api', () => ({ notificationsApi: mocks }));
vi.mock('@/lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false } }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('NotificationBell', () => {
  let items: NotificationDto[];

  beforeEach(() => {
    useAuthStore.setState({ user: makeUserDto(), status: 'authed' });
    items = [
      makeNotification({ title: 'Alice mentioned you', link: '/w/ws1/projects/p1/board?task=t1' }),
      makeNotification({ title: 'Task completed', readAt: new Date().toISOString() }),
    ];
    mocks.list.mockResolvedValue({ items, meta: { page: 1, limit: 10, total: 2, totalPages: 1 } });
    mocks.unreadCount.mockResolvedValue({ total: 7, byWorkspace: { ws1: 7 } });
    mocks.markRead.mockImplementation(async (id: string) => {
      // The server-side count drops too, so the refetch after settling agrees with the optimistic decrement.
      mocks.unreadCount.mockResolvedValue({ total: 6, byWorkspace: { ws1: 6 } });
      return { ...items.find((n) => n.id === id), readAt: new Date().toISOString() };
    });
  });

  it('shows the unread count badge', async () => {
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('7'));
    expect(screen.getByRole('button', { name: 'Notifications, 7 unread' })).toBeInTheDocument();
  });

  it('marks a notification read and navigates to its link when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <NotificationBell />
        <LocationProbe />
      </>,
      { route: '/w/ws1' },
    );
    await user.click(await screen.findByRole('button', { name: /notifications/i }));

    const list = await screen.findByRole('list', { name: 'Latest notifications' });
    const rows = within(list).getAllByTestId('notification-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-unread', 'true');
    expect(rows[1]).not.toHaveAttribute('data-unread');

    await user.click(within(rows[0] as HTMLElement).getByRole('button', { name: /Alice mentioned you/ }));

    expect(mocks.markRead).toHaveBeenCalledWith(items[0]?.id);
    expect(screen.getByTestId('location')).toHaveTextContent('/w/ws1/projects/p1/board?task=t1');
    // Optimistic decrement of the badge.
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('6'));
  });
});
