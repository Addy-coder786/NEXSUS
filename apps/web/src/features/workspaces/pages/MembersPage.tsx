import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { MoreHorizontal, Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { WORKSPACE_ROLES, type InvitationDto, type WorkspaceMemberDto, type WorkspaceRole } from '@nexus/shared';
import {
  useInvitations,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateRole,
} from '../hooks';
import { RoleBadge } from '../components/RoleBadge';
import { InviteMemberDialog } from '../components/InviteMemberDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import { usePermissions } from '@/lib/permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatDate, formatRelative } from '@/lib/format';
import { getErrorMessage } from '@/lib/api';
import { humanize } from '@/lib/utils';

export function MembersPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const me = useAuthStore((s) => s.user);
  const { role: myRole, can, canAssign } = usePermissions();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const members = useMembers(workspaceId, debounced || undefined);
  const canInvite = can('member:invite');
  const canManage = can('member:manage');
  const invitations = useInvitations(workspaceId, canInvite);
  const updateRole = useUpdateRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const revoke = useRevokeInvitation(workspaceId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceMemberDto | null>(null);

  const onChangeRole = (m: WorkspaceMemberDto, role: WorkspaceRole) => {
    if (role === m.role || role === 'OWNER') return;
    updateRole.mutate(
      { userId: m.user.id, role },
      {
        onSuccess: () => toast.success(`${m.user.name} is now ${humanize(role).toLowerCase()}`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const confirmRemove = () => {
    if (!removing) return;
    const target = removing;
    removeMember.mutate(target.user.id, {
      onSuccess: () => {
        toast.success(target.user.id === me?.id ? 'You left the workspace' : `${target.user.name} removed`);
        setRemoving(null);
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Members"
        description="People with access to this workspace and its projects."
        actions={
          canInvite ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Invite
            </Button>
          ) : null
        }
      >
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            aria-label="Search members"
            className="pl-8"
          />
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Member</th>
                <th scope="col" className="px-4 py-2 font-medium">Role</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Joined</th>
                <th scope="col" className="w-12 px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.isPending
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Skeleton className="size-7 rounded-full" /><Skeleton className="h-4 w-40" /></div></td>
                      <td className="px-4 py-2.5"><Skeleton className="h-4 w-16" /></td>
                      <td className="hidden px-4 py-2.5 sm:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-4 py-2.5" />
                    </tr>
                  ))
                : (members.data ?? []).map((m) => {
                    const isMe = m.user.id === me?.id;
                    const editable = canManage && !isMe && m.role !== 'OWNER' && myRole !== undefined && canAssign(m.role);
                    const canRemove = (canManage && !isMe && m.role !== 'OWNER' && canAssign(m.role)) || (isMe && m.role !== 'OWNER');
                    return (
                      <tr key={m.id} className="hover:bg-accent/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={m.user} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {m.user.name}
                                {isMe ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><RoleBadge role={m.role} /></td>
                        <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatDate(m.joinedAt)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {editable || canRemove ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.user.name}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                {editable ? (
                                  <>
                                    <DropdownMenuLabel>Change role</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup value={m.role} onValueChange={(v) => onChangeRole(m, v as WorkspaceRole)}>
                                      {WORKSPACE_ROLES.filter((r) => r !== 'OWNER' && canAssign(r)).map((r) => (
                                        <DropdownMenuRadioItem key={r} value={r}>{humanize(r)}</DropdownMenuRadioItem>
                                      ))}
                                    </DropdownMenuRadioGroup>
                                    <DropdownMenuSeparator />
                                  </>
                                ) : null}
                                {canRemove ? (
                                  <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>
                                    {isMe ? 'Leave workspace' : 'Remove from workspace'}
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
              {!members.isPending && (members.data?.length ?? 0) === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No members match your search.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canInvite ? (
          <section className="mt-8" aria-labelledby="pending-heading">
            <h2 id="pending-heading" className="mb-2 text-sm font-semibold">Pending invitations</h2>
            {invitations.isPending ? (
              <Skeleton className="h-16" />
            ) : (invitations.data?.length ?? 0) === 0 ? (
              <p className="text-[13px] text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {(invitations.data ?? []).map((inv: InvitationDto) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        Invited by {inv.invitedBy.name} {formatRelative(inv.createdAt)} · expires {formatDate(inv.expiresAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={inv.role} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revoke invitation for ${inv.email}`}
                        onClick={() =>
                          revoke.mutate(inv.id, {
                            onSuccess: () => toast.success('Invitation revoked'),
                            onError: (e) => toast.error(getErrorMessage(e)),
                          })
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <InviteMemberDialog workspaceId={workspaceId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.user.id === me?.id ? 'Leave this workspace?' : `Remove ${removing?.user.name ?? 'member'}?`}
        description={
          removing?.user.id === me?.id
            ? 'You will lose access to all projects in this workspace.'
            : 'They will immediately lose access to every project in this workspace.'
        }
        confirmLabel={removing?.user.id === me?.id ? 'Leave' : 'Remove'}
        destructive
        loading={removeMember.isPending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
