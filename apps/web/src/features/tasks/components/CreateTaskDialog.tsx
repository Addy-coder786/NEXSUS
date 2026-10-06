import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createTaskSchema, TASK_PRIORITIES, TASK_STATUSES, type ProjectDto, type TaskStatus } from '@nexus/shared';
import { toast } from 'sonner';
import { useCreateTask } from '../hooks';
import { PRIORITY_LABELS, STATUS_LABELS } from '../constants';
import { LabelPicker } from './LabelPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/common/FormField';
import { DatePicker } from '@/components/common/DatePicker';
import { applyApiErrorToForm } from '@/lib/form-errors';

const UNASSIGNED = '__none__';

const formSchema = createTaskSchema.pick({ title: true, description: true, status: true, priority: true }).extend({
  assigneeId: z.string(),
  dueDate: z.string().nullable(),
  labelIds: z.array(z.string()),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  project: ProjectDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStatus?: TaskStatus;
  parentTaskId?: string;
  onCreated?: (taskId: string) => void;
}

export function CreateTaskDialog({ project, open, onOpenChange, defaultStatus = 'TODO', parentTaskId, onCreated }: Props) {
  const create = useCreateTask(project.id);
  const { register, handleSubmit, control, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: undefined,
      status: defaultStatus,
      priority: 'MEDIUM',
      assigneeId: UNASSIGNED,
      dueDate: null,
      labelIds: [],
    },
  });

  useEffect(() => {
    if (open) {
      reset({ title: '', description: undefined, status: defaultStatus, priority: 'MEDIUM', assigneeId: UNASSIGNED, dueDate: null, labelIds: [] });
    }
  }, [open, defaultStatus, reset]);

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        title: values.title,
        description: values.description || undefined,
        status: values.status,
        priority: values.priority,
        assigneeId: values.assigneeId === UNASSIGNED ? null : values.assigneeId,
        dueDate: values.dueDate,
        labelIds: values.labelIds.length ? values.labelIds : undefined,
        parentTaskId: parentTaskId ?? undefined,
      },
      {
        onSuccess: (task) => {
          toast.success(`${task.key} created`);
          onOpenChange(false);
          onCreated?.(task.id);
        },
        onError: (error) =>
          applyApiErrorToForm(error, setError, {
            onOther: (message) => setError('root', { type: 'server', message }),
          }),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{parentTaskId ? 'New subtask' : 'New task'}</DialogTitle>
          <DialogDescription>
            In <span className="font-medium text-foreground">{project.name}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formState.errors.root ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {formState.errors.root.message}
            </p>
          ) : null}
          <FormField id="task-title" label="Title" required error={formState.errors.title?.message}>
            <Input placeholder="What needs to be done?" autoFocus {...register('title')} />
          </FormField>
          <FormField id="task-description" label="Description" error={formState.errors.description?.message}>
            <Textarea rows={3} placeholder="Add details, context or acceptance criteria" {...register('description', { setValueAs: (v: string) => (v ? v : undefined) })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <FormField id="task-status" label="Status">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <FormField id="task-priority" label="Priority">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="assigneeId"
              render={({ field }) => (
                <FormField id="task-assignee" label="Assignee" error={formState.errors.assigneeId?.message}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Assignee"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {project.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <FormField id="task-due" label="Due date" error={formState.errors.dueDate?.message}>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormField>
              )}
            />
          </div>
          {project.labels.length > 0 ? (
            <Controller
              control={control}
              name="labelIds"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium">Labels</span>
                  <LabelPicker labels={project.labels} value={field.value} onChange={field.onChange} />
                </div>
              )}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create task</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
