import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PROJECT_STATUSES, updateProjectSchema, type ProjectDto } from '@nexus/shared';
import { toast } from 'sonner';
import { useProjectContext } from './ProjectLayout';
import { useDeleteProject, useUpdateProject } from '../hooks';
import { ColorPicker } from '../components/ColorPicker';
import { LabelManager } from '../components/LabelManager';
import { ProjectMembersManager } from '../components/ProjectMembersManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField } from '@/components/common/FormField';
import { DatePicker } from '@/components/common/DatePicker';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePermissions } from '@/lib/permissions';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { getErrorMessage } from '@/lib/api';
import { humanize } from '@/lib/utils';

const formSchema = updateProjectSchema.pick({ name: true, description: true, color: true, status: true }).extend({
  startDate: z.string().nullable(),
  dueDate: z.string().nullable(),
});
type FormValues = z.infer<typeof formSchema>;

export function ProjectSettingsPage() {
  const project = useProjectContext();
  const { can } = usePermissions();
  const canUpdate = can('project:update');
  const canDelete = can('project:delete');
  const canEditLabels = can('task:update');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-6">
      <div className="max-w-2xl space-y-6">
        <DetailsCard key={project.updatedAt} project={project} readOnly={!canUpdate} />
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>Only project members can be assigned tasks. Viewers and members of the workspace see only projects they belong to.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectMembersManager project={project} canEdit={canUpdate} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Labels</CardTitle>
            <CardDescription>Labels are specific to this project.</CardDescription>
          </CardHeader>
          <CardContent>
            <LabelManager projectId={project.id} canEdit={canEditLabels} />
          </CardContent>
        </Card>
        {canDelete ? <DangerZone project={project} /> : null}
      </div>
    </div>
  );
}

function DetailsCard({ project, readOnly }: { project: ProjectDto; readOnly: boolean }) {
  const update = useUpdateProject(project.id);
  const { register, handleSubmit, control, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      color: project.color,
      status: project.status,
      startDate: project.startDate,
      dueDate: project.dueDate,
    },
  });

  const onSubmit = handleSubmit((values) => {
    update.mutate(
      {
        name: values.name,
        description: values.description ?? '',
        color: values.color,
        status: values.status,
        startDate: values.startDate,
        dueDate: values.dueDate,
      },
      {
        onSuccess: () => toast.success('Project updated'),
        onError: (error) => applyApiErrorToForm(error, setError),
      },
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Key <span className="font-mono">{project.key}</span> cannot be changed.
          {readOnly ? ' Only managers and above can edit project details.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="p-name" label="Name" error={formState.errors.name?.message}>
            <Input disabled={readOnly} {...register('name')} />
          </FormField>
          <FormField id="p-description" label="Description" error={formState.errors.description?.message}>
            <Textarea rows={3} disabled={readOnly} {...register('description')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <FormField id="p-status" label="Status">
                  <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
                    <SelectTrigger aria-label="Project status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {humanize(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div className="space-y-1.5">
                  <span className="text-[13px] font-medium">Color</span>
                  <ColorPicker value={field.value ?? project.color} onChange={field.onChange} disabled={readOnly} />
                </div>
              )}
            />
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <FormField id="p-start" label="Start date" error={formState.errors.startDate?.message}>
                  <DatePicker value={field.value} onChange={field.onChange} disabled={readOnly} />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <FormField id="p-due" label="Due date" error={formState.errors.dueDate?.message}>
                  <DatePicker value={field.value} onChange={field.onChange} disabled={readOnly} />
                </FormField>
              )}
            />
          </div>
          {!readOnly ? (
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
                Save changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function DangerZone({ project }: { project: ProjectDto }) {
  const navigate = useNavigate();
  const remove = useDeleteProject(project.workspaceId);
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>Deleting the project removes all of its tasks and comments permanently.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete project
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete "${project.name}"?`}
        description="All tasks, subtasks and comments in this project will be deleted. This cannot be undone."
        confirmLabel="Delete project"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(project.id, {
            onSuccess: () => {
              toast.success('Project deleted');
              navigate(`/w/${project.workspaceId}`, { replace: true });
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </Card>
  );
}
