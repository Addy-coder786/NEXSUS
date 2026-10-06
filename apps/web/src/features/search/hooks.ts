import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SEARCH_TYPES, type SearchType } from '@nexus/shared';
import { searchApi } from './api';
import { useDebouncedValue } from '@/lib/use-debounced-value';

export const searchKeys = {
  all: ['search'] as const,
  query: (workspaceId: string, q: string, types: readonly SearchType[], limit: number) =>
    [...searchKeys.all, workspaceId, q, [...types].sort().join(','), limit] as const,
};

/** Debounced (250 ms) workspace search; disabled until there is a query. */
export function useSearch(
  workspaceId: string | null | undefined,
  q: string,
  types: readonly SearchType[] = SEARCH_TYPES,
  limit = 5,
  options: { enabled?: boolean } = {},
) {
  const debounced = useDebouncedValue(q.trim(), 250);
  const query = useQuery({
    queryKey: searchKeys.query(workspaceId ?? '', debounced, types, limit),
    queryFn: () => searchApi.search(workspaceId as string, { q: debounced, types, limit }),
    enabled: Boolean(workspaceId) && debounced.length > 0 && types.length > 0 && (options.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  return { ...query, debouncedQuery: debounced, isDebouncing: debounced !== q.trim() };
}

const MAX_RECENT = 8;
const recentKey = (workspaceId: string) => `nexus-recent-searches:${workspaceId}`;

function readRecent(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(recentKey(workspaceId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Recent search terms persisted per workspace in localStorage. */
export function useRecentSearches(workspaceId: string | null | undefined) {
  const [recent, setRecent] = useState<string[]>(() => (workspaceId ? readRecent(workspaceId) : []));

  useEffect(() => {
    setRecent(workspaceId ? readRecent(workspaceId) : []);
  }, [workspaceId]);

  const persist = useCallback(
    (next: string[]) => {
      setRecent(next);
      if (!workspaceId) return;
      try {
        localStorage.setItem(recentKey(workspaceId), JSON.stringify(next));
      } catch {
        /* ignore quota / privacy mode */
      }
    },
    [workspaceId],
  );

  const add = useCallback(
    (term: string) => {
      const t = term.trim();
      if (!t) return;
      persist([t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, MAX_RECENT));
    },
    [persist, recent],
  );

  const remove = useCallback((term: string) => persist(recent.filter((r) => r !== term)), [persist, recent]);
  const clear = useCallback(() => persist([]), [persist]);

  return { recent, add, remove, clear };
}
