import { useState } from 'react';
import { ACTIVITY_TYPES, type ActivityType } from '@nexus/shared';
import { useProjectContext } from './ProjectLayout';
import { useProjectActivities } from '../hooks';
import { ActivityFeed } from '@/features/activity/components/ActivityFeed';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { humanize } from '@/lib/utils';

const ALL = '__all__';

export function ProjectActivityPage() {
  const project = useProjectContext();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>(ALL);
  const activities = useProjectActivities(project.id, {
    page,
    limit: 25,
    type: type === ALL ? undefined : (type as ActivityType),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Filter by activity type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All activity</SelectItem>
            {ACTIVITY_TYPES.filter((t) => t.startsWith('TASK_') || t.startsWith('COMMENT_') || t.startsWith('PROJECT_')).map((t) => (
              <SelectItem key={t} value={t}>
                {humanize(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-2">
        <div className="max-w-3xl">
          <ActivityFeed
            items={activities.data?.items}
            meta={activities.data?.meta}
            isLoading={activities.isPending}
            error={activities.error}
            onPageChange={setPage}
            emptyDescription="Task changes, comments and membership updates in this project will show up here."
          />
        </div>
      </div>
    </div>
  );
}
