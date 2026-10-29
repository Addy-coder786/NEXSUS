import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBootstrapAuth } from '../hooks';
import { useAuthStore } from '@/stores/auth.store';

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));
vi.mock('../api', () => ({ authApi: { me: meMock } }));

function Probe() {
  useBootstrapAuth();
  return null;
}

beforeEach(() => {
  meMock.mockReset();
  useAuthStore.setState({ user: null, status: 'idle' });
});

describe('useBootstrapAuth', () => {
  it('resolves to authed under StrictMode with a single request', async () => {
    const user = { id: 'u1', name: 'Ada', email: 'ada@example.com' };
    meMock.mockResolvedValue(user);
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await waitFor(() => expect(useAuthStore.getState().status).toBe('authed'));
    expect(useAuthStore.getState().user).toEqual(user);
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('resolves to anon when the session check fails', async () => {
    meMock.mockRejectedValue(new Error('401'));
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await waitFor(() => expect(useAuthStore.getState().status).toBe('anon'));
  });
});
