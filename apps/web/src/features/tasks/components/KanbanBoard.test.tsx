import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanBoard } from './KanbanBoard';
import { makeTask } from '@/test/utils';

describe('KanbanBoard', () => {
  const tasks = [
    makeTask({ status: 'BACKLOG', title: 'Idea' }),
    makeTask({ status: 'TODO', title: 'First', position: 2048 }),
    makeTask({ status: 'TODO', title: 'Zeroth', position: 1024 }),
    makeTask({ status: 'IN_PROGRESS', title: 'Working' }),
    makeTask({ status: 'DONE', title: 'Shipped' }),
    makeTask({ status: 'DONE', title: 'Also shipped' }),
  ];

  it('renders the five columns with counts and groups tasks by status', () => {
    render(<KanbanBoard tasks={tasks} canEdit onOpenTask={vi.fn()} />);

    const expected: Record<string, number> = { BACKLOG: 1, TODO: 2, IN_PROGRESS: 1, REVIEW: 0, DONE: 2 };
    for (const [status, count] of Object.entries(expected)) {
      const column = screen.getByTestId(`column-${status}`);
      expect(within(column).getByTestId('column-count')).toHaveTextContent(String(count));
      expect(within(column).queryAllByTestId('task-card')).toHaveLength(count);
    }
    expect(screen.getByRole('heading', { name: 'In progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'To do' })).toBeInTheDocument();
  });

  it('orders cards within a column by position', () => {
    render(<KanbanBoard tasks={tasks} canEdit onOpenTask={vi.fn()} />);
    const todo = screen.getByTestId('column-TODO');
    const titles = within(todo)
      .getAllByTestId('task-card')
      .map((el) => el.querySelector('p')?.textContent);
    expect(titles).toEqual(['Zeroth', 'First']);
  });

  it('hides the per-column "new task" buttons for read-only users', () => {
    const { rerender } = render(<KanbanBoard tasks={tasks} canEdit onOpenTask={vi.fn()} onCreateTask={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /new task in/i })).toHaveLength(5);
    rerender(<KanbanBoard tasks={tasks} canEdit={false} onOpenTask={vi.fn()} onCreateTask={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /new task in/i })).not.toBeInTheDocument();
  });
});
