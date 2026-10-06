import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createProjectSchema } from '@nexus/shared';
import { toast } from 'sonner';
import { useCreateProject } from '../hooks';
import { ColorPicker, PROJECT_COLORS } from './ColorPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField } from '@/components/common/FormField';
import { DatePicker } from '@/components/common/DatePicker';
import { applyApiErrorToForm } from '@/lib/form-errors';

const formSchema = createProjectSchema.pick({ name: true, key: true, description: true, color: true }).extend({
  dueDate: z.string().nullable(),
});
type FormValues = z.infer<typeof formSchema>;

function keyFromName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  let key = words.length === 1 ? (words[0] ?? '').slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 5);
  key = key.replace(/^[^A-Z]+/, '');
  return key.length >= 2 ? key : '';
}

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ workspaceId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const create = useCreateProject(workspaceId);
  const { register, handleSubmit, control, setError, reset, watch, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', key: undefined, description: undefined, color: PROJECT_COLORS[0], dueDate: null },
  });
  const name = watch('name');

  useEffect(() => {
    if (!formState.dirtyFields.key) {
      const k = keyFromName(name ?? '');
      setValue('key', k || undefined, { shouldDirty: false });
    }
  }, [name, formState.dirtyFields.key, setValue]);

  useEffect(() => {
    if (open) reset({ name: '', key: undefined, description: undefined, color: PROJECT_COLORS[0], dueDate: null });
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        key: values.key || undefined,
        description: values.description || undefined,
        color: values.color,
        dueDate: values.dueDate ?? undefined,
      },
      {
        onSuccess: (project) => {
          toast.success(`Project "${project.name}" created`);
          onOpenChange(false);
          navigate(`/w/${workspaceId}/projects/${project.id}`);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Projects hold tasks, a board and labels. You are added as a member automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formState.errors.root ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {formState.errors.root.message}
            </p>
          ) : null}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <FormField id="project-name" label="Name" required error={formState.errors.name?.message}>
              <Input placeholder="Website redesign" autoFocus {...register('name')} />
            </FormField>
            <FormField id="project-key" label="Key" error={formState.errors.key?.message} hint="e.g. WEB-12">
              <Input
                placeholder="WEB"
                className="font-mono uppercase"
                maxLength={10}
                {...register('key', { setValueAs: (v: string) => (v ? v.toUpperCase() : undefined) })}
              />
            </FormField>
          </div>
          <FormField id="project-description" label="Description" error={formState.errors.description?.message}>
            <Textarea rows={2} {...register('description', { setValueAs: (v: string) => (v ? v : undefined) })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium">Color</span>
                  <ColorPicker value={field.value ?? PROJECT_COLORS[0]} onChange={field.onChange} />
                </div>
              )}
            />
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <FormField id="project-due" label="Due date" error={formState.errors.dueDate?.message}>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormField>
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
