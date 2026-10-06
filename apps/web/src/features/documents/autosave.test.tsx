import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDto, UpdateDocumentInput } from '@nexus/shared';
import { useAutosave } from './autosave';
import { SaveIndicator } from './components/SaveIndicator';
import { ConflictBanner } from './components/ConflictBanner';
import { ApiClientError } from '@/lib/api';
import { makeUser } from '@/test/utils';

function makeDoc(version: number): DocumentDto {
  const user = makeUser();
  const now = new Date().toISOString();
  return {
    id: 'doc1',
    workspaceId: 'ws1',
    projectId: null,
    title: 'Untitled',
    icon: null,
    excerpt: '',
    isArchived: false,
    version,
    createdBy: user,
    updatedBy: user,
    createdAt: now,
    updatedAt: now,
    content: { type: 'doc', content: [] },
  };
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces 1 s after the last change and sends baseVersion, then adopts the returned version', async () => {
    const save = vi.fn(async (input: UpdateDocumentInput) => makeDoc((input.baseVersion ?? 0) + 1));
    const { result } = renderHook(() => useAutosave({ initialVersion: 1, save }));

    act(() => result.current.markDirty({ title: 'Plan' }));
    expect(result.current.status).toBe('unsaved');
    act(() => vi.advanceTimersByTime(600));
    act(() => result.current.markDirty({ content: { type: 'doc', content: [] } }));
    act(() => vi.advanceTimersByTime(999));
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    // Patches are merged into one request.
    expect(save.mock.calls[0]?.[0]).toMatchObject({ title: 'Plan', content: { type: 'doc' }, baseVersion: 1 });
    expect(result.current.status).toBe('saved');
    expect(result.current.baseVersion).toBe(2);

    act(() => result.current.markDirty({ title: 'Plan v2' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({ title: 'Plan v2', baseVersion: 2 });
    expect(result.current.baseVersion).toBe(3);
  });

  it('flushes pending changes immediately on demand', async () => {
    const save = vi.fn(async (input: UpdateDocumentInput) => makeDoc((input.baseVersion ?? 0) + 1));
    const { result } = renderHook(() => useAutosave({ initialVersion: 4, save }));
    act(() => result.current.markDirty({ icon: '🚀' }));
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledWith({ icon: '🚀', baseVersion: 4 });
    expect(result.current.status).toBe('saved');
  });

  it('switches to conflict on a 409 and the banner is shown', async () => {
    const save = vi.fn(async () => {
      throw new ApiClientError({ status: 409, code: 'CONFLICT', message: 'Conflict', details: { currentVersion: 9 } });
    });

    function Harness() {
      const autosave = useAutosave({ initialVersion: 2, save });
      return (
        <div>
          <SaveIndicator status={autosave.status} />
          {autosave.status === 'conflict' ? <ConflictBanner onReload={() => undefined} /> : null}
          <button type="button" onClick={() => autosave.markDirty({ title: 'Edited' })}>
            edit
          </button>
        </div>
      );
    }

    render(<Harness />);
    act(() => {
      screen.getByRole('button', { name: 'edit' }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveAttribute('data-status', 'conflict');
    expect(screen.getByRole('alert')).toHaveTextContent(/document changed elsewhere/i);

    // Further edits do not trigger saves until the document is reloaded.
    act(() => {
      screen.getByRole('button', { name: 'edit' }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
