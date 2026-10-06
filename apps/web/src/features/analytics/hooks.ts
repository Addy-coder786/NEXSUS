import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { analyticsApi } from './api';

export const WEEK_OPTIONS = [4, 8, 12, 26] as const;
export type Weeks = (typeof WEEK_OPTIONS)[number];

export const analyticsKeys = {
  all: ['analytics'] as const,
  project: (id: string, weeks: number) => [...analyticsKeys.all, 'project', id, weeks] as const,
  workspace: (id: string, weeks: number) => [...analyticsKeys.all, 'workspace', id, weeks] as const,
};

export function useProjectAnalytics(projectId: string | undefined, weeks: number) {
  return useQuery({
    queryKey: analyticsKeys.project(projectId ?? '', weeks),
    queryFn: () => analyticsApi.project(projectId as string, weeks),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useWorkspaceAnalytics(workspaceId: string | null | undefined, weeks: number) {
  return useQuery({
    queryKey: analyticsKeys.workspace(workspaceId ?? '', weeks),
    queryFn: () => analyticsApi.workspace(workspaceId as string, weeks),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

function isWeeks(v: number): v is Weeks {
  return (WEEK_OPTIONS as readonly number[]).includes(v);
}

/** Trailing-weeks window, persisted in `?weeks=`. */
export function useWeeks(defaultWeeks: Weeks = 8): [Weeks, (w: Weeks) => void] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get('weeks'));
  const weeks: Weeks = isWeeks(raw) ? raw : defaultWeeks;
  const set = (w: Weeks) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('weeks', String(w));
        return next;
      },
      { replace: true },
    );
  return [weeks, set];
}

/** True when the OS asks for reduced motion; charts then skip entrance animations. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}
