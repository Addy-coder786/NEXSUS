import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { renderWithProviders } from '@/test/utils';

vi.mock('@/features/auth/api', () => ({
  authApi: {
    providers: vi.fn(async () => ({ google: true, slack: false })),
    login: vi.fn(async () => {
      throw new Error('should not be called');
    }),
    resendVerification: vi.fn(),
  },
  oauthStartUrl: (provider: string, redirect: string) => `/api/auth/${provider}?redirect=${redirect}`,
}));

describe('LoginPage', () => {
  it('renders validation errors when submitting an empty form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a specific error for a malformed email', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/^password$/i), 'secret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
  });

  it('shows OAuth buttons returned by the providers endpoint', async () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    await waitFor(() => expect(screen.getByRole('link', { name: /google/i })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /slack/i })).not.toBeInTheDocument();
  });
});
