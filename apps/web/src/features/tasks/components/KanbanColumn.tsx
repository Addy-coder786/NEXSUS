import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import type { TaskDto, TaskStatus } from '@nexus/shared';
import { STATUS_LABELS } from '../constants';
import { STATUS_DOT } from './StatusBadge';
import { SortableTaskCard } from './TaskCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const columnDroppableId = (status: TaskStatus): string => `column:${status}`;
export const statusFromDroppableId = (id: string): TaskStatus | null =>
  id.startsWith('column:') ? (id.slice('column:'.length) as TaskStatus) : null;

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: TaskDto[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onCreateTask?: (status: TaskStatus) => void;
}

export function KanbanColumn({ status, tasks, canEdit, onOpenTask, onCreateTask }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnDroppableId(status),
    data: { type: 'column', status },
    disabled: !canEdit,
  });

  return (
    <section
      aria-label={`${STATUS_LABELS[status]} column`}
      data-testid={`column-${status}`}
      className="flex h-full w-72 shrink-0 flex-col rounded-lg bg-muted/40"
    >
      <header className="flex h-10 items-center justify-between px-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className={cn('size-2 rounded-full', STATUS_DOT[status])} aria-hidden />
          <h2>{STATUS_LABELS[status]}</h2>
          <span className="rounded-full bg-background px-1.5 text-2xs text-muted-foreground" data-testid="column-count">
            {tasks.length}
          </span>
        </div>
        {canEdit && onCreateTask ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`New task in ${STATUS_LABELS[status]}`}
            className="text-muted-foreground"
            onClick={() => onCreateTask(status)}
          >
            <Plus />
          </Button>
        ) : null}
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scrollbar-thin px-2 pb-2 transition-colors rounded-b-lg',
          isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onOpen={onOpenTask} disabled={!canEdit} />
          ))}
        </SortableContext>
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground min-h-16">
            {canEdit ? 'Drop tasks here' : 'No tasks'}
          </div>
        ) : null}
      </div>
    </section>
  );
}
