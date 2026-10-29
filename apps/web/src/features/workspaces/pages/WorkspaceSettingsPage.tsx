import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateWorkspaceSchema, type UpdateWorkspaceInput } from '@nexus/shared';
import { toast } from 'sonner';
import { useCurrentWorkspace, useDeleteWorkspace, useMembers, useTransferOwnership, useUpdateWorkspace } from '../hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiSettingsPanel } from '@/features/ai/components/AiSettingsPanel';
import { FormField } from '@/components/common/FormField';
import { SlackIntegrationCard } from '@/features/integrations/components/SlackIntegrationCard';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { usePermissions } from '@/lib/permissions';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { getErrorMessage } from '@/lib/api';

export function WorkspaceSettingsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const workspace = useCurrentWorkspace();
  const { can } = usePermissions();
  const canUpdate = can('workspace:update');
  const canDelete = can('workspace:delete');
  const canTransfer = can('workspace:transfer');
  const canManageIntegrations = can('integration:manage');
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab =
    requestedTab === 'integrations' && canManageIntegrations
      ? 'integrations'
      : requestedTab === 'ai' && canUpdate
        ? 'ai'
        : 'general';
  const setTab = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'general') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Workspace settings" description="Name, URL, ownership and integrations of this workspace." />
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <Tabs value={tab} onValueChange={setTab} className="max-w-2xl">
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="general">General</TabsTrigger>
            {canManageIntegrations ? <TabsTrigger value="integrations">Integrations</TabsTrigger> : null}
            {canUpdate ? <TabsTrigger value="ai">AI</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="general" className="mt-4 space-y-6">
            {workspace.data ? (
              <GeneralSettings
                key={workspace.data.id}
                workspaceId={workspaceId}
                defaults={{
                  name: workspace.data.name,
                  slug: workspace.data.slug,
                  description: workspace.data.description ?? '',
                }}
                readOnly={!canUpdate}
              />
            ) : (
              <Skeleton className="h-64" />
            )}
            {canTransfer ? <TransferOwnership workspaceId={workspaceId} /> : null}
            {canDelete && workspace.data ? <DangerZone workspaceId={workspaceId} name={workspace.data.name} /> : null}
          </TabsContent>
          {canManageIntegrations ? (
            <TabsContent value="integrations" className="mt-4 space-y-6">
              <SlackIntegrationCard workspaceId={workspaceId} />
            </TabsContent>
          ) : null}
          {canUpdate ? (
            <TabsContent value="ai" className="mt-4 space-y-6">
              <AiSettingsPanel workspaceId={workspaceId} />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </div>
  );
}

type GeneralValues = { name: string; slug: string; description: string };

function GeneralSettings({
  workspaceId,
  defaults,
  readOnly,
}: {
  workspaceId: string;
  defaults: GeneralValues;
  readOnly: boolean;
}) {
  const update = useUpdateWorkspace(workspaceId);
  const { register, handleSubmit, setError, formState, reset } = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    reset(defaults);
  }, [defaults.name, defaults.slug, defaults.description]);

  const onSubmit = handleSubmit((values) => {
    update.mutate(
      { name: values.name, slug: values.slug, description: values.description ?? '' },
      {
        onSuccess: () => toast.success('Workspace updated'),
        onError: (error) => applyApiErrorToForm(error, setError),
      },
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>
          {readOnly ? 'Only owners and admins can change these settings.' : 'Basic information about the workspace.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="ws-name" label="Name" error={formState.errors.name?.message}>
            <Input disabled={readOnly} {...register('name')} />
          </FormField>
          <FormField id="ws-slug" label="URL slug" error={formState.errors.slug?.message}>
            <Input disabled={readOnly} {...register('slug')} />
          </FormField>
          <FormField id="ws-description" label="Description" error={formState.errors.description?.message}>
            <Textarea rows={3} disabled={readOnly} {...register('description')} />
          </FormField>
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

function TransferOwnership({ workspaceId }: { workspaceId: string }) {
  const members = useMembers(workspaceId);
  const transfer = useTransferOwnership(workspaceId);
  const [userId, setUserId] = useState<string>('');
  const [confirm, setConfirm] = useState(false);
  const candidates = (members.data ?? []).filter((m) => m.role !== 'OWNER');
  const target = candidates.find((m) => m.user.id === userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
        <CardDescription>Hand this workspace over to another member. You will become an admin.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="transfer-target" className="text-[13px] font-medium">
            New owner
          </label>
          <Select value={userId} onValueChange={setUserId} disabled={candidates.length === 0}>
            <SelectTrigger id="transfer-target">
              <SelectValue placeholder={candidates.length === 0 ? 'No other members' : 'Choose a member'} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.user.id} value={m.user.id}>
                  {m.user.name} · {m.user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={!target} onClick={() => setConfirm(true)}>
          Transfer
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Transfer ownership to ${target?.user.name ?? ''}?`}
        description="They will gain full control, including the ability to delete the workspace. This cannot be undone by you."
        confirmLabel="Transfer ownership"
        destructive
        loading={transfer.isPending}
        onConfirm={() =>
          target &&
          transfer.mutate(target.user.id, {
            onSuccess: () => {
              toast.success(`${target.user.name} is now the owner`);
              setConfirm(false);
              setUserId('');
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </Card>
  );
}

function DangerZone({ workspaceId, name }: { workspaceId: string; name: string }) {
  const navigate = useNavigate();
  const remove = useDeleteWorkspace();
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting the workspace permanently removes all projects, tasks, comments and members.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped('');
        }}
        title={`Delete "${name}"?`}
        description={
          <span className="block space-y-2">
            <span className="block">
              This action cannot be undone. Type <strong>{name}</strong> to confirm.
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Workspace name confirmation" />
          </span>
        }
        confirmLabel="Delete forever"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (typed !== name) {
            toast.error('Workspace name does not match');
            return;
          }
          remove.mutate(workspaceId, {
            onSuccess: () => {
              toast.success('Workspace deleted');
              setCurrent(null);
              navigate('/', { replace: true });
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </Card>
  );
}
