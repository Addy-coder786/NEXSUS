import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthCard, HealthPill } from './HealthCard';

describe('HealthCard', () => {
  it('colours the status pill and ring by health status', () => {
    const { rerender } = render(
      <HealthCard health={{ status: 'ON_TRACK', score: 92, reasons: [], recommendation: null }} avgCycleTimeDays={3.25} />,
    );
    const onTrack = screen.getByText('On track');
    expect(onTrack).toHaveClass('text-success');
    expect(onTrack.closest('[data-health]')).toHaveAttribute('data-health', 'ON_TRACK');
    expect(screen.getByRole('img', { name: /health score 92/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is dragging/i)).toBeInTheDocument();
    expect(screen.getByText('3.3 days')).toBeInTheDocument();

    rerender(
      <HealthCard
        health={{
          status: 'OFF_TRACK',
          score: 31,
          reasons: ['4 tasks are overdue', 'Project due date has passed'],
          recommendation: 'Finish WEB-12 (urgent, 9 days overdue).',
        }}
      />,
    );
    expect(screen.getByText('Off track')).toHaveClass('text-destructive');
    expect(screen.getByRole('list', { name: 'Reasons' }).children).toHaveLength(2);
    expect(screen.getByText(/finish web-12/i)).toBeInTheDocument();
  });

  it('renders the at-risk pill with the warning tone', () => {
    render(<HealthPill status="AT_RISK" />);
    const pill = screen.getByText('At risk');
    expect(pill).toHaveClass('text-warning');
    expect(pill).toHaveAttribute('data-health', 'AT_RISK');
  });
});
