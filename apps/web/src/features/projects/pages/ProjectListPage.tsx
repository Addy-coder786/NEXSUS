import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Plus } from 'lucide-react';
import type { TaskDto } from '@nexus/shared';
import { useProjectContext } from './ProjectLayout';
import { useTasks } from '@/features/tasks/hooks';
import { useTaskFilters } from '@/features/tasks/use-task-filters';
import { TaskFilters } from '@/features/tasks/components/TaskFilters';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { CreateTaskDialog } from '@/features/tasks/components/CreateTaskDialog';
import { StatusBadge } from '@/features/tasks/components/StatusBadge';
import { PriorityIcon } from '@/features/tasks/components/PriorityIcon';
import { AssigneeAvatar } from '@/features/tasks/components/AssigneeAvatar';
import { DueDateBadge } from '@/features/tasks/components/DueDateBadge';
import { PRIORITY_RANK } from '@/features/tasks/constants';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { usePermissions } from '@/lib/permissions';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type SortKey = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'updatedAt';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<TaskDto['status'], number> = { BACKLOG: 0, TODO: 1, IN_PROGRESS: 2, REVIEW: 3, DONE: 4 };

function compare(a: TaskDto, b: TaskDto, key: SortKey): number {
  switch (key) {
    case 'key':
      return a.number - b.number;
    case 'title':
      return a.title.localeCompare(b.title);
    case 'status':
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case 'priority':
      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    case 'assignee':
      return (a.assignee?.name ?? '~').localeCompare(b.assignee?.name ?? '~');
    case 'dueDate':
      return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    case 'updatedAt':
      return b.updatedAt.localeCompare(a.updatedAt);
  }
}

export function ProjectListPage() {
  const project = useProjectContext();
  const { can } = usePermissions();
  const canCreate = can('task:create');
  const { filters, selectedTaskId, openTask, closeTask } = useTaskFilters();
  const tasks = useTasks(project.id, { ...filters, limit: 500, sort: 'createdAt', order: 'desc' });
  const [createOpen, setCreateOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'updatedAt', dir: 'asc' });

  const rows = useMemo(() => {
    const items = [...(tasks.data?.items ?? [])];
    items.sort((a, b) => {
      const c = compare(a, b, sort.key);
      return sort.dir === 'asc' ? c : -c;
    });
    return items;
  }, [tasks.data, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <>
      <TaskFilters
        project={project}
        withStatus
        trailing={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> New task
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {tasks.isPending ? (
          <div className="space-y-px p-6" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : tasks.isError ? (
          <p role="alert" className="p-6 text-[13px] text-destructive">{tasks.error.message}</p>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Inbox />}
              title="No tasks match"
              description="Try clearing the filters or create a new task."
              action={
                canCreate ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> New task
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <table className="w-full min-w-[800px] border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-background text-left text-xs text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
              <tr>
                <SortableTh label="Key" k="key" sort={sort} onSort={toggleSort} className="w-24 pl-6" />
                <SortableTh label="Title" k="title" sort={sort} onSort={toggleSort} />
                <SortableTh label="Status" k="status" sort={sort} onSort={toggleSort} className="w-32" />
                <SortableTh label="Priority" k="priority" sort={sort} onSort={toggleSort} className="w-28" />
                <SortableTh label="Assignee" k="assignee" sort={sort} onSort={toggleSort} className="w-16" />
                <SortableTh label="Due" k="dueDate" sort={sort} onSort={toggleSort} className="w-28" />
                <SortableTh label="Updated" k="updatedAt" sort={sort} onSort={toggleSort} className="w-28 pr-6" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr
                  key={t.id}
                  tabIndex={0}
                  onClick={() => openTask(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openTask(t.id);
                  }}
                  className="cursor-pointer outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
                  aria-label={`${t.key}: ${t.title}`}
                >
                  <td className="py-2 pl-6 pr-3 font-mono text-xs text-muted-foreground">{t.key}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('truncate font-medium', t.status === 'DONE' && 'text-muted-foreground line-through')}>
                        {t.title}
                      </span>
                      {t.labels.slice(0, 3).map((l) => (
                        <span key={l.id} className="hidden rounded-sm px-1.5 text-2xs font-medium lg:inline" style={{ backgroundColor: `${l.color}22`, color: l.color }}>
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                  <td className="px-3 py-2"><PriorityIcon priority={t.priority} withLabel /></td>
                  <td className="px-3 py-2"><AssigneeAvatar assignee={t.assignee} size="sm" /></td>
                  <td className="px-3 py-2"><DueDateBadge dueDate={t.dueDate} completedAt={t.completedAt} /></td>
                  <td className="py-2 pl-3 pr-6 text-xs text-muted-foreground">{formatRelative(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <TaskDetailDrawer taskId={selectedTaskId} project={project} onClose={closeTask} onOpenTask={openTask} />
      <CreateTaskDialog project={project} open={createOpen} onOpenChange={setCreateOpen} onCreated={openTask} />
    </>
  );
}

function SortableTh({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" className={cn('px-3 py-2 font-medium', className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}>
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}
