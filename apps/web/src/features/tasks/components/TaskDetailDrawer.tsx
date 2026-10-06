import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ChecklistItem,
  type ProjectDto,
  type TaskPriority,
  type TaskStatus,
} from '@nexus/shared';
import { useDeleteTask, useTask, useUpdateTask } from '../hooks';
import { STATUS_LABELS } from '../constants';
import { PriorityIcon } from './PriorityIcon';
import { STATUS_DOT } from './StatusBadge';
import { LabelPicker } from './LabelPicker';
import { TaskChecklist } from './TaskChecklist';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskComments } from './TaskComments';
import { TaskAttachments } from '@/features/files/components/TaskAttachments';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { DatePicker } from '@/components/common/DatePicker';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useAuthStore } from '@/stores/auth.store';
import { usePermissions } from '@/lib/permissions';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const UNASSIGNED = '__none__';

interface TaskDetailDrawerProps {
  taskId: string | null;
  project: ProjectDto;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}

export function TaskDetailDrawer({ taskId, project, onClose, onOpenTask }: TaskDetailDrawerProps) {
  const open = taskId !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-3xl p-0" aria-describedby={undefined}>
        {taskId ? <TaskDetail key={taskId} taskId={taskId} project={project} onClose={onClose} onOpenTask={onOpenTask} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({
  taskId,
  project,
  onClose,
  onOpenTask,
}: {
  taskId: string;
  project: ProjectDto;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const task = useTask(taskId);
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const me = useAuthStore((s) => s.user);
  const { role, can } = usePermissions();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canEdit = can('task:update');
  const canComment = can('comment:create');
  const isManager = role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
  const data = task.data;
  const canDelete =
    can('task:delete') && Boolean(data) && (isManager || data?.createdBy.id === me?.id || data?.assignee?.id === me?.id);

  const patch = (input: Parameters<typeof update.mutate>[0] extends infer T ? Omit<T, 'id'> : never) =>
    update.mutate({ id: taskId, ...input });

  if (task.isPending) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <DialogTitle className="sr-only">Loading task</DialogTitle>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-3/4" />
        <SkeletonLines lines={4} />
      </div>
    );
  }
  if (task.isError || !data) {
    return (
      <div className="p-6">
        <DialogTitle>Task not found</DialogTitle>
        <DialogDescription className="mt-1">{task.error?.message ?? 'This task may have been deleted.'}</DialogDescription>
        <Button className="mt-4" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const taskUrl = `/w/${data.workspaceId}/projects/${data.projectId}/tasks/${data.id}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-5 py-2.5 pr-12 text-xs text-muted-foreground">
        {data.parentTaskId ? (
          <>
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => onOpenTask(data.parentTaskId as string)}>
              Parent task
            </button>
            <span aria-hidden>/</span>
          </>
        ) : null}
        <span className="font-mono text-foreground">{data.key}</span>
        <div className="ml-auto flex items-center gap-1">
          <SimpleTooltip label="Copy link">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy task link"
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}${taskUrl}`);
                toast.success('Link copied');
              }}
            >
              <Copy />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip label="Open full page">
            <Button variant="ghost" size="icon-sm" asChild aria-label="Open task page">
              <Link to={taskUrl}>
                <ExternalLink />
              </Link>
            </Button>
          </SimpleTooltip>
          {canDelete ? (
            <SimpleTooltip label="Delete task">
              <Button variant="ghost" size="icon-sm" aria-label="Delete task" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
              </Button>
            </SimpleTooltip>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_260px]">
        <div className="min-h-0 space-y-6 overflow-y-auto scrollbar-thin p-5">
          <TitleEditor
            title={data.title}
            disabled={!canEdit}
            onSave={(title) => patch({ title })}
          />
          <DescriptionEditor
            description={data.description}
            disabled={!canEdit}
            onSave={(description) => patch({ description })}
          />
          <TaskChecklist
            items={data.checklist}
            disabled={!canEdit}
            onChange={(checklist: ChecklistItem[]) => patch({ checklist })}
          />
          <TaskSubtasks task={data} project={project} canEdit={canEdit} onOpen={onOpenTask} />
          <TaskAttachments taskId={data.id} projectId={data.projectId} workspaceId={data.workspaceId} />
          <Separator />
          <TaskComments taskId={data.id} projectId={data.projectId} canComment={canComment} canModerate={isManager} />
        </div>

        <aside className="min-h-0 space-y-4 overflow-y-auto scrollbar-thin border-t bg-muted/30 p-4 md:border-l md:border-t-0">
          <Field label="Status">
            <Select value={data.status} disabled={!canEdit} onValueChange={(v) => patch({ status: v as TaskStatus })}>
              <SelectTrigger size="sm" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="inline-flex items-center gap-2">
                      <span className={cn('size-2 rounded-full', STATUS_DOT[s])} aria-hidden />
                      {STATUS_LABELS[s]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={data.priority} disabled={!canEdit} onValueChange={(v) => patch({ priority: v as TaskPriority })}>
              <SelectTrigger size="sm" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    <PriorityIcon priority={p} withLabel />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assignee">
            <Select
              value={data.assignee?.id ?? UNASSIGNED}
              disabled={!canEdit}
              onValueChange={(v) => patch({ assigneeId: v === UNASSIGNED ? null : v })}
            >
              <SelectTrigger size="sm" aria-label="Assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {project.members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="inline-flex items-center gap-2">
                      <UserAvatar user={m} size="xs" />
                      {m.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Due date">
            <DatePicker
              value={data.dueDate}
              disabled={!canEdit}
              aria-label="Due date"
              className="h-7 text-xs"
              onChange={(dueDate) => patch({ dueDate })}
            />
          </Field>
          <Field label="Labels">
            <LabelPicker
              labels={project.labels}
              value={data.labels.map((l) => l.id)}
              disabled={!canEdit}
              onChange={(labelIds) => patch({ labelIds })}
            />
          </Field>
          <Separator />
          <dl className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>Created</dt>
              <dd title={formatDateTime(data.createdAt)}>
                {formatRelative(data.createdAt)} by {data.createdBy.name}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Updated</dt>
              <dd title={formatDateTime(data.updatedAt)}>{formatRelative(data.updatedAt)}</dd>
            </div>
            {data.completedAt ? (
              <div className="flex justify-between gap-2">
                <dt>Completed</dt>
                <dd title={formatDateTime(data.completedAt)}>{formatRelative(data.completedAt)}</dd>
              </div>
            ) : null}
            {data.estimateHours !== null ? (
              <div className="flex justify-between gap-2">
                <dt>Estimate</dt>
                <dd>{data.estimateHours}h</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${data.key}?`}
        description="Subtasks and comments will be deleted too. This cannot be undone."
        confirmLabel="Delete task"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(data, {
            onSuccess: () => {
              toast.success(`${data.key} deleted`);
              setConfirmDelete(false);
              onClose();
            },
          })
        }
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1">
      <span id={id} className="block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div aria-labelledby={id}>{children}</div>
    </div>
  );
}

function TitleEditor({ title, disabled, onSave }: { title: string; disabled: boolean; onSave: (title: string) => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(title), [title]);

  const commit = () => {
    const next = value.trim();
    if (!next) {
      setValue(title);
      return;
    }
    if (next !== title) onSave(next);
  };

  return (
    <div>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <Textarea
        ref={ref}
        value={value}
        disabled={disabled}
        aria-label="Task title"
        rows={1}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            ref.current?.blur();
          }
          if (e.key === 'Escape') {
            setValue(title);
            ref.current?.blur();
          }
        }}
        className="min-h-0 resize-none border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold leading-snug shadow-none hover:border-border focus-visible:bg-card disabled:opacity-100"
      />
    </div>
  );
}

function DescriptionEditor({
  description,
  disabled,
  onSave,
}: {
  description: string | null;
  disabled: boolean;
  onSave: (description: string | null) => void;
}) {
  const [value, setValue] = useState(description ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setValue(description ?? '');
    setDirty(false);
  }, [description]);

  const save = () => {
    const next = value.trim();
    onSave(next ? next : null);
    setDirty(false);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
      <Textarea
        value={value}
        disabled={disabled}
        aria-label="Description"
        placeholder={disabled ? 'No description' : 'Add a description…'}
        rows={4}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        className="disabled:opacity-100"
      />
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(description ?? '');
              setDirty(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            <Check /> Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

