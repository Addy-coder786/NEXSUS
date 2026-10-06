import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import { makeLabel, makeTask, makeUser } from '@/test/utils';

describe('TaskCard', () => {
  it('renders key, title, labels, counts and assignee', () => {
    const task = makeTask({
      key: 'WEB-42',
      title: 'Ship the Kanban board',
      labels: [makeLabel({ name: 'frontend' })],
      subtaskCount: 5,
      subtaskDoneCount: 2,
      commentCount: 3,
      assignee: makeUser({ name: 'Priya Sharma' }),
    });
    render(<TaskCard task={task} />);

    expect(screen.getByText('WEB-42')).toBeInTheDocument();
    expect(screen.getByText('Ship the Kanban board')).toBeInTheDocument();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/assigned to priya sharma/i)).toBeInTheDocument();
  });

  it('flags an overdue due date', () => {
    const task = makeTask({ dueDate: '2020-01-01T12:00:00.000Z', completedAt: null });
    render(<TaskCard task={task} />);
    const due = screen.getByText('(overdue)').closest('[data-overdue]');
    expect(due).not.toBeNull();
    expect(due).toHaveClass('text-destructive');
  });

  it('does not flag a completed task as overdue', () => {
    const task = makeTask({ dueDate: '2020-01-01T12:00:00.000Z', completedAt: '2020-01-05T12:00:00.000Z' });
    render(<TaskCard task={task} />);
    expect(screen.queryByText('(overdue)')).not.toBeInTheDocument();
  });

  it('opens on click and on Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = makeTask({ id: 'abc' });
    render(<TaskCard task={task} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: new RegExp(task.key) });
    await user.click(card);
    card.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith('abc');
  });
});
