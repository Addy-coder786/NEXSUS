import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkspaceSchema, type CreateWorkspaceInput } from '@nexus/shared';
import { toast } from 'sonner';
import { useCreateWorkspace } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/common/FormField';
import { applyApiErrorToForm } from '@/lib/form-errors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>A workspace groups your team, projects and tasks.</DialogDescription>
        </DialogHeader>
        <CreateWorkspaceForm onDone={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function CreateWorkspaceForm({
  onDone,
  onCancel,
  submitLabel = 'Create workspace',
}: {
  onDone?: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const { register, handleSubmit, setError, watch, setValue, formState, reset } = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '', slug: undefined, description: undefined },
  });
  const name = watch('name');
  const slug = watch('slug');

  // Keep the slug in sync with the name until the user edits the slug manually.
  useEffect(() => {
    if (!formState.dirtyFields.slug) {
      const next = slugify(name ?? '');
      setValue('slug', next.length >= 3 ? next : undefined, { shouldDirty: false });
    }
  }, [name, formState.dirtyFields.slug, setValue]);

  const onSubmit = handleSubmit((values) => {
    const payload: CreateWorkspaceInput = {
      name: values.name,
      // An auto-filled slug is only a suggestion: leave it to the server, which appends -2, -3...
      // when it is taken. A slug the user typed is sent and must be free.
      slug: values.slug && formState.dirtyFields.slug ? values.slug : undefined,
      description: values.description ? values.description : undefined,
    };
    create.mutate(payload, {
      onSuccess: (ws) => {
        toast.success(`Workspace "${ws.name}" created`);
        reset();
        if (onDone) onDone(ws.id);
        navigate(`/w/${ws.id}`);
      },
      onError: (error) =>
        applyApiErrorToForm(error, setError, {
          onOther: (message) => setError('root', { type: 'server', message }),
        }),
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formState.errors.root ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {formState.errors.root.message}
        </p>
      ) : null}
      <FormField id="ws-name" label="Name" required error={formState.errors.name?.message}>
        <Input placeholder="Acme Inc." autoFocus {...register('name')} />
      </FormField>
      <FormField
        id="ws-slug"
        label="URL slug"
        error={formState.errors.slug?.message}
        hint={slug ? `nexus.app/${slug}` : 'Lowercase letters, numbers and hyphens'}
      >
        <Input placeholder="acme" {...register('slug', { setValueAs: (v: string) => (v ? v : undefined) })} />
      </FormField>
      <FormField id="ws-description" label="Description" error={formState.errors.description?.message}>
        <Textarea
          placeholder="What is this workspace for?"
          rows={2}
          {...register('description', { setValueAs: (v: string) => (v ? v : undefined) })}
        />
      </FormField>
      <DialogFooter>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={create.isPending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
