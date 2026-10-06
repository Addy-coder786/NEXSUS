import type { ActivityQuery } from '@nexus/shared';

export const projectKeys = {
  all: ['projects'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
  labels: (id: string) => [...projectKeys.all, 'labels', id] as const,
  activities: (id: string, query?: Partial<ActivityQuery>) =>
    [...projectKeys.all, 'activities', id, query ?? {}] as const,
};
