import type { ActivityDto, PaginationQuery } from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

export const activityApi = {
  mine: (query?: Partial<PaginationQuery>): Promise<Paged<ActivityDto>> =>
    api.getPaged<ActivityDto>('/activities/me', cleanParams({ ...query })),
};
