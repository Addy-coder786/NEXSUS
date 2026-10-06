import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResultsDto } from '@nexus/shared';
import type * as RouterModule from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { makeTask, makeUser, renderWithProviders } from '@/test/utils';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof RouterModule>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/features/workspaces/hooks', () => ({
  useCurrentWorkspaceId: () => 'ws1',
  useWorkspaceProjects: () => ({ data: [{ id: 'p1', name: 'Web', color: '#000' }] }),
}));

vi.mock('@/lib/permissions', () => ({
  useCan: () => true,
}));

vi.mock('@/features/documents/hooks', () => ({
  useCreateDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

const results: SearchResultsDto = {
  query: 'kan',
  tasks: [makeTask({ id: 't1', projectId: 'p1', key: 'WEB-7', title: 'Kanban board polish' })],
  projects: [],
  documents: [
    {
      id: 'd1',
      workspaceId: 'ws1',
      projectId: null,
      title: 'Kanban guidelines',
      icon: null,
      excerpt: 'How we use the kanban board',
      isArchived: false,
      version: 1,
      createdBy: makeUser(),
      updatedBy: makeUser(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  messages: [],
  files: [],
  users: [],
  counts: { tasks: 1, projects: 0, documents: 1, messages: 0, files: 0, users: 0 },
};

let currentQuery = '';
vi.mock('../hooks', () => ({
  useSearch: (_ws: string, q: string) => {
    currentQuery = q;
    const has = q.trim().length > 0;
    return {
      data: has ? results : undefined,
      isPending: false,
      isError: false,
      isFetching: false,
      error: null,
      debouncedQuery: q,
      isDebouncing: false,
    };
  },
  useRecentSearches: () => ({ recent: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn() }),
}));

describe('CommandPalette', () => {
  beforeEach(() => {
    navigate.mockClear();
    currentQuery = '';
  });

  it('opens with Ctrl+K and closes again on a second press', () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox', { name: /search/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows quick actions when empty and grouped results when typing', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('group', { name: 'Quick actions' })).toBeInTheDocument();
    expect(screen.getByText('New task')).toBeInTheDocument();
    expect(screen.getByText('New document')).toBeInTheDocument();
    expect(screen.getByText('Go to Chat')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'kan' } });
    expect(currentQuery).toBe('kan');
    const tasks = screen.getByRole('group', { name: 'Tasks' });
    expect(within(tasks).getByText('WEB-7')).toBeInTheDocument();
    const docs = screen.getByRole('group', { name: 'Documents' });
    expect(within(docs).getByText(/guidelines/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Projects' })).not.toBeInTheDocument();
    // Matches are wrapped in <mark>.
    expect(within(tasks).getByText('Kan', { selector: 'mark' })).toBeInTheDocument();
  });

  it('navigates to the active result on Enter and supports arrow keys', () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'kan' } });

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/w/ws1/projects/p1/board?task=t1');

    // Reopen (Enter closed it), move to the document and open it.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input2 = screen.getByRole('combobox');
    fireEvent.change(input2, { target: { value: 'kan' } });
    fireEvent.keyDown(input2, { key: 'ArrowDown' });
    fireEvent.keyDown(input2, { key: 'Enter' });
    expect(navigate).toHaveBeenLastCalledWith('/w/ws1/docs/d1');
  });
});
