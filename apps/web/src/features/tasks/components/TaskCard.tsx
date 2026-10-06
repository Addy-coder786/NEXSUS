import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckSquare, MessageSquare } from 'lucide-react';
import type { TaskDto } from '@nexus/shared';
import { PriorityIcon } from './PriorityIcon';
import { AssigneeAvatar } from './AssigneeAvatar';
import { DueDateBadge } from './DueDateBadge';
import { cn } from '@/lib/utils';

export interface TaskCardProps {
  task: TaskDto;
  onOpen?: (id: string) => void;
  /** Visual-only ghost rendered inside DragOverlay. */
  overlay?: boolean;
  /** Dimmed placeholder left in the column while its card is being dragged. */
  dragging?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Extra props (dnd-kit listeners/attributes) spread onto the root element. */
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
}

/** Presentational Kanban card. Keyboard: Enter/Space opens. */
export const TaskCard = React.forwardRef<HTMLDivElement, TaskCardProps>(
  ({ task, onOpen, overlay = false, dragging = false, className, style, rootProps }, ref) => {
    const open = () => onOpen?.(task.id);
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      rootProps?.onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        open();
      }
    };
    return (
      <div
        ref={ref}
        style={style}
        {...rootProps}
        role="button"
        tabIndex={0}
        aria-label={`${task.key}: ${task.title}`}
        data-testid="task-card"
        onClick={open}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-2.5 text-left shadow-sm outline-none transition-[box-shadow,border-color]',
          'hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring',
          overlay && 'rotate-[1.5deg] shadow-xl ring-2 ring-primary/40 cursor-grabbing',
          dragging && 'opacity-40',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-2xs text-muted-foreground">{task.key}</span>
          <PriorityIcon priority={task.priority} />
        </div>
        <p className={cn('text-[13px] font-medium leading-snug', task.status === 'DONE' && 'text-muted-foreground line-through')}>
          {task.title}
        </p>
        {task.labels.length > 0 ? (
          <ul className="flex flex-wrap gap-1" aria-label="Labels">
            {task.labels.map((l) => (
              <li
                key={l.id}
                className="rounded-sm px-1.5 py-px text-2xs font-medium leading-4"
                style={{ backgroundColor: `${l.color}22`, color: l.color }}
              >
                {l.name}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
            <DueDateBadge dueDate={task.dueDate} completedAt={task.completedAt} />
            {task.subtaskCount > 0 ? (
              <span className="inline-flex items-center gap-1" title="Subtasks done">
                <CheckSquare className="size-3" aria-hidden />
                {task.subtaskDoneCount}/{task.subtaskCount}
              </span>
            ) : null}
            {task.commentCount > 0 ? (
              <span className="inline-flex items-center gap-1" title="Comments">
                <MessageSquare className="size-3" aria-hidden />
                {task.commentCount}
              </span>
            ) : null}
          </div>
          <AssigneeAvatar assignee={task.assignee} size="xs" />
        </div>
      </div>
    );
  },
);
TaskCard.displayName = 'TaskCard';

/** Sortable wrapper used inside Kanban columns. */
export function SortableTaskCard({
  task,
  onOpen,
  disabled,
}: {
  task: TaskDto;
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      onOpen={onOpen}
      style={style}
      dragging={isDragging}
      rootProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>}
      className={disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
    />
  );
}
