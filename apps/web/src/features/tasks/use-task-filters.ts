import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@nexus/shared';
import type { TaskFilters } from './api';

export interface RawTaskFilters {
  search: string;
  assignee: string; // '' | 'me' | 'unassigned' | userId
  priority: string; // '' | TaskPriority
  label: string; // '' | labelId
  status: string; // '' | TaskStatus (list view only)
}

const KEYS: (keyof RawTaskFilters)[] = ['search', 'assignee', 'priority', 'label', 'status'];

function isPriority(v: string): v is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(v);
}
function isStatus(v: string): v is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(v);
}

/** Filters + selected task, persisted in the URL search params (`?search=&assignee=&priority=&label=&task=`). */
export function useTaskFilters() {
  const [params, setParams] = useSearchParams();

  const raw: RawTaskFilters = useMemo(
    () => ({
      search: params.get('search') ?? '',
      assignee: params.get('assignee') ?? '',
      priority: params.get('priority') ?? '',
      label: params.get('label') ?? '',
      status: params.get('status') ?? '',
    }),
    [params],
  );

  const filters: TaskFilters = useMemo(() => {
    const f: TaskFilters = {};
    if (raw.search) f.search = raw.search;
    if (raw.assignee) f.assigneeId = raw.assignee as TaskFilters['assigneeId'];
    if (raw.priority && isPriority(raw.priority)) f.priority = raw.priority;
    if (raw.label) f.labelId = raw.label;
    if (raw.status && isStatus(raw.status)) f.status = raw.status;
    return f;
  }, [raw]);

  const set = useCallback(
    (key: keyof RawTaskFilters, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of KEYS) next.delete(k);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const selectedTaskId = params.get('task');
  const openTask = useCallback(
    (id: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', id);
        return next;
      });
    },
    [setParams],
  );
  const closeTask = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('task');
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const activeCount = KEYS.filter((k) => raw[k] !== '').length;

  return { raw, filters, set, clear, activeCount, selectedTaskId, openTask, closeTask };
}
