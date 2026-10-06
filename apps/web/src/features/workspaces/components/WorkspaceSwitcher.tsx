import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Hexagon, Plus } from 'lucide-react';
import { useCurrentWorkspaceId, useWorkspaces } from '../hooks';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, initials } from '@/lib/utils';

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const currentId = useCurrentWorkspaceId();
  const workspaces = useWorkspaces();
  const [createOpen, setCreateOpen] = useState(false);
  const current = workspaces.data?.find((w) => w.id === currentId);

  if (workspaces.isPending) {
    return <Skeleton className={cn('h-7', collapsed ? 'w-7' : 'flex-1')} />;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn('h-8 justify-start gap-2 px-1.5 font-medium', collapsed ? 'w-8 px-0 justify-center' : 'flex-1')}
            aria-label="Switch workspace"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-2xs font-bold text-primary-foreground">
              {current ? initials(current.name).slice(0, 1) : <Hexagon className="size-3" />}
            </span>
            {!collapsed ? (
              <>
                <span className="truncate text-[13px]">{current?.name ?? 'Select workspace'}</span>
                <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {(workspaces.data ?? []).map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => navigate(`/w/${w.id}`)}>
              <span className="flex size-5 items-center justify-center rounded bg-secondary text-2xs font-semibold">
                {initials(w.name).slice(0, 1)}
              </span>
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === currentId ? <Check className="size-3.5" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
