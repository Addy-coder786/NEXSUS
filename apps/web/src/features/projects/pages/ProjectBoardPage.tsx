import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { TaskStatus } from '@nexus/shared';
import { useProjectContext } from './ProjectLayout';
import { useMoveTask, useTasks } from '@/features/tasks/hooks';
import { useTaskFilters } from '@/features/tasks/use-task-filters';
import { KanbanBoard } from '@/features/tasks/components/KanbanBoard';
import { TaskFilters } from '@/features/tasks/components/TaskFilters';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { CreateTaskDialog } from '@/features/tasks/components/CreateTaskDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/lib/permissions';
import { GenerateTasksDialog } from '@/features/ai/components/GenerateTasksDialog';
import { useAiEnabled } from '@/features/ai/hooks';

export function ProjectBoardPage() {
  const project = useProjectContext();
  const { can } = usePermissions();
  const canEdit = can('task:update');
  const canCreate = can('task:create');
  const canGenerate = useAiEnabled() && can('ai:generate') && canCreate;
  const [generating, setGenerating] = useState(false);
  const { filters, selectedTaskId, openTask, closeTask } = useTaskFilters();
  const tasks = useTasks(project.id, { ...filters, parentTaskId: 'none', limit: 500, sort: 'position', order: 'asc' });
  const move = useMoveTask(project.id);
  const [create, setCreate] = useState<{ open: boolean; status: TaskStatus }>({ open: false, status: 'TODO' });

  return (
    <>
      <TaskFilters
        project={project}
        trailing={
          canCreate ? (
            <div className="flex items-center gap-2">
              {canGenerate ? (
                <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>
                  <Sparkles /> Generate with AI
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setCreate({ open: true, status: 'TODO' })}>
                <Plus /> New task
              </Button>
            </div>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        {tasks.isPending ? (
          <div className="flex h-full gap-3 overflow-hidden px-6 pt-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-20" />
                <Skeleton className="h-24" />
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        ) : tasks.isError ? (
          <p role="alert" className="p-6 text-[13px] text-destructive">{tasks.error.message}</p>
        ) : (
          <KanbanBoard
            tasks={tasks.data.items}
            canEdit={canEdit}
            onOpenTask={openTask}
            onCreateTask={canCreate ? (status) => setCreate({ open: true, status }) : undefined}
            onMoveTask={(args) => move.mutate(args)}
          />
        )}
      </div>
      <TaskDetailDrawer taskId={selectedTaskId} project={project} onClose={closeTask} onOpenTask={openTask} />
      <CreateTaskDialog
        project={project}
        open={create.open}
        defaultStatus={create.status}
        onOpenChange={(open) => setCreate((s) => ({ ...s, open }))}
        onCreated={openTask}
      />
      <GenerateTasksDialog open={generating} onOpenChange={setGenerating} workspaceId={project.workspaceId} projectId={project.id} />
    </>
  );
}
