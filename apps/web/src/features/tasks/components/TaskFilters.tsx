import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { TASK_PRIORITIES, TASK_STATUSES, type ProjectDto } from '@nexus/shared';
import { useTaskFilters } from '../use-task-filters';
import { PRIORITY_LABELS, STATUS_LABELS } from '../constants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth.store';

const ALL = '__all__';

interface TaskFiltersProps {
  project: ProjectDto;
  /** Show a status filter (list view). */
  withStatus?: boolean;
  /** Extra controls rendered at the right end (e.g. "New task"). */
  trailing?: React.ReactNode;
}

export function TaskFilters({ project, withStatus = false, trailing }: TaskFiltersProps) {
  const { raw, set, clear, activeCount } = useTaskFilters();
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState(raw.search);

  // Debounce typing into the URL.
  useEffect(() => {
    if (search === raw.search) return;
    const t = setTimeout(() => set('search', search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reflect external changes (clear, back navigation).
  useEffect(() => {
    setSearch(raw.search);
  }, [raw.search]);

  const toParam = (v: string) => (v === ALL ? '' : v);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="h-7 w-52 pl-8 text-xs"
        />
      </div>

      <Select value={raw.assignee || ALL} onValueChange={(v) => set('assignee', toParam(v))}>
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by assignee">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any assignee</SelectItem>
          {me ? <SelectItem value="me">Assigned to me</SelectItem> : null}
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {project.members.length > 0 ? <SelectSeparator /> : null}
          {project.members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={raw.priority || ALL} onValueChange={(v) => set('priority', toParam(v))}>
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by priority">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any priority</SelectItem>
          {TASK_PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={raw.label || ALL} onValueChange={(v) => set('label', toParam(v))}>
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by label">
          <SelectValue placeholder="Label" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any label</SelectItem>
          {project.labels.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                {l.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {withStatus ? (
        <Select value={raw.status || ALL} onValueChange={(v) => set('status', toParam(v))}>
          <SelectTrigger size="sm" className="w-32" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
          <X /> Clear
        </Button>
      ) : null}

      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
