import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto } from '@nexus/shared';
import { useAddProjectMembers, useRemoveProjectMember } from '../hooks';
import { useMembers } from '@/features/workspaces/hooks';
import { RoleBadge } from '@/features/workspaces/components/RoleBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserAvatar } from '@/components/common/UserAvatar';
import { getErrorMessage } from '@/lib/api';

interface Props {
  project: ProjectDto;
  canEdit: boolean;
}

export function ProjectMembersManager({ project, canEdit }: Props) {
  const wsMembers = useMembers(canEdit ? project.workspaceId : undefined);
  const add = useAddProjectMembers(project.id);
  const remove = useRemoveProjectMember(project.id);
  const [selected, setSelected] = useState('');

  const memberIds = new Set(project.members.map((m) => m.id));
  const candidates = (wsMembers.data ?? []).filter((m) => !memberIds.has(m.user.id));
  const roleOf = (userId: string) => wsMembers.data?.find((m) => m.user.id === userId)?.role;

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border">
        {project.members.map((m) => {
          const role = roleOf(m.id);
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <UserAvatar user={m} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name}</div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </div>
              {role ? <RoleBadge role={role} /> : null}
              {canEdit ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${m.name} from project`}
                  onClick={() =>
                    remove.mutate(m.id, {
                      onSuccess: () => toast.success(`${m.name} removed from project`),
                      onError: (e) => toast.error(getErrorMessage(e)),
                    })
                  }
                >
                  <X />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected} disabled={candidates.length === 0}>
            <SelectTrigger className="w-72" aria-label="Workspace member to add">
              <SelectValue placeholder={candidates.length === 0 ? 'All workspace members are in this project' : 'Add a workspace member'} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.user.id} value={m.user.id}>
                  {m.user.name} · {m.user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!selected}
            loading={add.isPending}
            onClick={() =>
              add.mutate([selected], {
                onSuccess: () => {
                  setSelected('');
                  toast.success('Member added');
                },
                onError: (e) => toast.error(getErrorMessage(e)),
              })
            }
          >
            <Plus /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
