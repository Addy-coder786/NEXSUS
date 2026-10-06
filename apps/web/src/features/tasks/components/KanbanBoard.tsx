import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { TASK_STATUSES, type TaskDto, type TaskStatus } from '@nexus/shared';
import { KanbanColumn, statusFromDroppableId } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { groupTasksByStatus, resolveDrop } from '../position';

export interface KanbanBoardProps {
  tasks: TaskDto[];
  /** Whether the current user may drag / create. VIEWER gets a read-only board. */
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onCreateTask?: (status: TaskStatus) => void;
  onMoveTask?: (args: { id: string; status: TaskStatus; position: number }) => void;
}

export function KanbanBoard({ tasks, canEdit, onOpenTask, onCreateTask, onMoveTask }: KanbanBoardProps) {
  const columns = useMemo(() => groupTasksByStatus(tasks, TASK_STATUSES), [tasks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !canEdit || !onMoveTask) return;
    const task = tasks.find((t) => t.id === String(active.id));
    if (!task) return;

    const overId = String(over.id);
    const overColumn = statusFromDroppableId(overId);
    let targetStatus: TaskStatus | null = overColumn;
    let overTaskId: string | null = null;
    if (!targetStatus) {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      overTaskId = overTask.id;
    }

    const result = resolveDrop({ active: task, overTaskId, targetStatus, columns });
    if (!result) return;
    onMoveTask({ id: task.id, ...result });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full gap-3 overflow-x-auto scrollbar-thin px-6 pb-4 pt-4" data-testid="kanban-board">
        {TASK_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={columns[status]}
            canEdit={canEdit}
            onOpenTask={onOpenTask}
            onCreateTask={onCreateTask}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {activeTask ? <TaskCard task={activeTask} overlay className="w-[17rem]" /> : null}
      </DragOverlay>
    </DndContext>
  );
}
