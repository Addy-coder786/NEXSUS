import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { ProjectDto, TaskDto } from '@nexus/shared';
import { useCreateTask, useSubtasks, useUpdateTask } from '../hooks';
import { StatusBadge } from './StatusBadge';
import { PriorityIcon } from './PriorityIcon';
import { AssigneeAvatar } from './AssigneeAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface TaskSubtasksProps {
  task: TaskDto;
  project: ProjectDto;
  canEdit: boolean;
  onOpen: (id: string) => void;
}

export function TaskSubtasks({ task, project, canEdit, onOpen }: TaskSubtasksProps) {
  const subtasks = useSubtasks(task.id);
  const create = useCreateTask(project.id);
  const update = useUpdateTask();
  const [draft, setDraft] = useState('');

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    create.mutate({ title, parentTaskId: task.id, status: 'TODO', priority: 'MEDIUM' }, { onSuccess: () => setDraft('') });
  };

  const items = subtasks.data ?? [];
  const done = items.filter((s) => s.status === 'DONE').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subtasks</h3>
        {items.length > 0 ? <span className="text-xs text-muted-foreground">{done}/{items.length}</span> : null}
      </div>
      {subtasks.isPending ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No subtasks.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
              <Checkbox
                checked={s.status === 'DONE'}
                disabled={!canEdit}
                aria-label={`Mark ${s.key} ${s.status === 'DONE' ? 'not done' : 'done'}`}
                onCheckedChange={(v) => update.mutate({ id: s.id, status: v === true ? 'DONE' : 'TODO' })}
              />
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className={cn('min-w-0 flex-1 truncate text-left hover:underline', s.status === 'DONE' && 'text-muted-foreground line-through')}
              >
                <span className="mr-1.5 font-mono text-2xs text-muted-foreground">{s.key}</span>
                {s.title}
              </button>
              <StatusBadge status={s.status} className="hidden sm:inline-flex" />
              <PriorityIcon priority={s.priority} />
              <AssigneeAvatar assignee={s.assignee} size="xs" />
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a subtask"
            aria-label="New subtask title"
            className="h-7 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" loading={create.isPending} disabled={!draft.trim()}>
            <Plus /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
