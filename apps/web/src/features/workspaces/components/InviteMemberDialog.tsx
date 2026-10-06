import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inviteMemberSchema, WORKSPACE_ROLES, type InviteMemberInput, type WorkspaceRole } from '@nexus/shared';
import { toast } from 'sonner';
import { useInvite } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { usePermissions } from '@/lib/permissions';
import { humanize } from '@/lib/utils';

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const roleHelp: Record<WorkspaceRole, string> = {
  OWNER: '',
  ADMIN: 'Manage members, settings and all projects',
  MANAGER: 'Create and manage projects',
  MEMBER: 'Work on tasks in assigned projects',
  VIEWER: 'Read-only access to assigned projects',
};

export function InviteMemberDialog({ workspaceId, open, onOpenChange }: Props) {
  const invite = useInvite(workspaceId);
  const { canAssign } = usePermissions();
  const { register, handleSubmit, control, setError, reset, formState } = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '', role: 'MEMBER' },
  });

  const assignable = WORKSPACE_ROLES.filter((r) => r !== 'OWNER' && canAssign(r));

  const onSubmit = handleSubmit((values) => {
    invite.mutate(values, {
      onSuccess: (inv) => {
        toast.success(`Invitation sent to ${inv.email}`);
        reset();
        onOpenChange(false);
      },
      onError: (error) =>
        applyApiErrorToForm(error, setError, {
          onOther: (message) => setError('root', { type: 'server', message }),
        }),
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>They will receive an email with a link to join this workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formState.errors.root ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {formState.errors.root.message}
            </p>
          ) : null}
          <FormField id="invite-email" label="Email" required error={formState.errors.email?.message}>
            <Input type="email" placeholder="teammate@company.com" autoFocus {...register('email')} />
          </FormField>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <FormField
                id="invite-role"
                label="Role"
                error={formState.errors.role?.message}
                hint={roleHelp[field.value]}
              >
                <Select value={field.value} onValueChange={(v) => field.onChange(v as WorkspaceRole)}>
                  <SelectTrigger aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignable.map((r) => (
                      <SelectItem key={r} value={r}>
                        {humanize(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
