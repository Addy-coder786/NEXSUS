import { useQuery } from '@tanstack/react-query';
import type { PaginationQuery } from '@nexus/shared';
import { activityApi } from './api';

export const activityKeys = {
  all: ['activities'] as const,
  mine: (query?: Partial<PaginationQuery>) => [...activityKeys.all, 'me', query ?? {}] as const,
};

export function useMyActivity(query?: Partial<PaginationQuery>) {
  return useQuery({
    queryKey: activityKeys.mine(query),
    queryFn: () => activityApi.mine(query),
    placeholderData: (prev) => prev,
  });
}
