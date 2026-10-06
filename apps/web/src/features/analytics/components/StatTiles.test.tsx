import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskSummaryStats } from '@nexus/shared';
import { StatTiles } from './StatTiles';

const summary: TaskSummaryStats = {
  total: 42,
  byStatus: { BACKLOG: 5, TODO: 10, IN_PROGRESS: 8, REVIEW: 4, DONE: 15 },
  byPriority: { LOW: 10, MEDIUM: 20, HIGH: 9, URGENT: 3 },
  overdue: 3,
  unassigned: 6,
  blocked: 1,
  dueNext7Days: 7,
  completedLast7Days: 9,
  createdLast7Days: 11,
  progressPercent: 36,
};

describe('StatTiles', () => {
  it('renders every headline number with an accessible progress bar', () => {
    render(<StatTiles summary={summary} />);
    expect(within(screen.getByTestId('stat-total')).getByText('42')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-overdue')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-due7')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-done7')).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-unassigned')).getByText('6')).toBeInTheDocument();
    const progress = within(screen.getByTestId('stat-progress'));
    expect(progress.getByText('36')).toBeInTheDocument();
    expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '36');
    expect(screen.getByText('Total tasks')).toBeInTheDocument();
  });

  it('renders skeletons while loading', () => {
    const { container } = render(<StatTiles summary={undefined} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('stat-total')).not.toBeInTheDocument();
  });
});
