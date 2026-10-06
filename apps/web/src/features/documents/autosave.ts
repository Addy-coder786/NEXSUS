import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentDto, UpdateDocumentInput } from '@nexus/shared';
import { isApiError } from '@/lib/api';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

export type AutosavePatch = Pick<UpdateDocumentInput, 'content' | 'contentText' | 'title' | 'icon'>;

export interface UseAutosaveOptions {
  /** Version of the document as loaded into the editor. */
  initialVersion: number;
  /** Performs the PATCH; receives the merged patch plus `baseVersion`. */
  save: (input: UpdateDocumentInput) => Promise<DocumentDto>;
  /** Debounce after the last change, ms. */
  delayMs?: number;
  /** When false, changes are ignored (read-only). */
  enabled?: boolean;
  /** Latest version known from the server cache; a newer one while idle means a conflict. */
  remoteVersion?: number;
}

export interface UseAutosaveResult {
  status: SaveStatus;
  baseVersion: number;
  lastSavedAt: Date | null;
  error: string | null;
  /** Merge a change into the pending patch and (re)start the debounce timer. */
  markDirty: (patch: AutosavePatch) => void;
  /** Send whatever is pending right now (unmount, tab hidden, explicit save). */
  flush: () => Promise<void>;
  /** After reloading the document from the server, adopt its version and clear state. */
  reset: (version: number) => void;
}

/**
 * Debounced autosave with optimistic-concurrency bookkeeping.
 *
 * - `markDirty` merges partial patches; the request fires `delayMs` after the last change.
 * - Every request carries `baseVersion`; the response's `version` becomes the next base.
 * - A 409 switches to `conflict` and stops saving until `reset`.
 * - Changes made while a save is in flight are kept and sent in a follow-up request.
 * - Pending changes are flushed on unmount and when the tab becomes hidden.
 */
export function useAutosave({
  initialVersion,
  save,
  delayMs = 1000,
  enabled = true,
  remoteVersion,
}: UseAutosaveOptions): UseAutosaveResult {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [baseVersion, setBaseVersion] = useState(initialVersion);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseRef = useRef(initialVersion);
  const pendingRef = useRef<AutosavePatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const run = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const patch = pendingRef.current;
    if (!patch || conflictRef.current || !enabledRef.current) return;
    pendingRef.current = null;
    setStatus('saving');
    const promise = (async () => {
      try {
        const doc = await saveRef.current({ ...patch, baseVersion: baseRef.current });
        baseRef.current = doc.version;
        setBaseVersion(doc.version);
        setLastSavedAt(new Date());
        setError(null);
        setStatus(pendingRef.current ? 'unsaved' : 'saved');
      } catch (err) {
        if (isApiError(err) && err.status === 409) {
          conflictRef.current = true;
          pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
          setStatus('conflict');
          return;
        }
        // Keep the change so the next edit retries it.
        pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
        setError(err instanceof Error ? err.message : 'Could not save');
        setStatus('error');
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = promise;
    await promise;
    // Changes arrived while saving: send them now.
    if (pendingRef.current && !conflictRef.current) await run();
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    await run();
  }, [run]);

  const markDirty = useCallback(
    (patch: AutosavePatch) => {
      if (!enabledRef.current || conflictRef.current) return;
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      setStatus((s) => (s === 'saving' ? s : 'unsaved'));
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void run();
      }, delayMs);
    },
    [delayMs, run],
  );

  const reset = useCallback((version: number) => {
    clearTimer();
    pendingRef.current = null;
    conflictRef.current = false;
    baseRef.current = version;
    setBaseVersion(version);
    setError(null);
    setStatus('saved');
  }, []);

  // A newer version appeared from elsewhere (realtime refetch) while we were idle.
  useEffect(() => {
    if (remoteVersion === undefined) return;
    if (conflictRef.current || inFlightRef.current || pendingRef.current) return;
    if (remoteVersion > baseRef.current) {
      conflictRef.current = true;
      setStatus('conflict');
    }
  }, [remoteVersion]);

  // Flush when the tab is hidden and on unmount.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void flush();
    };
  }, [flush]);

  return { status, baseVersion, lastSavedAt, error, markDirty, flush, reset };
}
