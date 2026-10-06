import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { useOpenDm } from '../hooks';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useMembers } from '@/features/workspaces/hooks';
import { usePresence } from '@/features/realtime/hooks';
import { useAuthStore } from '@/stores/auth.store';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewDmDialog({ workspaceId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const myId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const members = useMembers(open ? workspaceId : undefined);
  const openDm = useOpenDm(workspaceId);

  useEffect(() => {
    if (open) {
      setSearch('');
      setActive(0);
    }
  }, [open]);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members.data ?? [])
      .map((m) => m.user)
      .filter((u) => u.id !== myId)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [members.data, search, myId]);

  useEffect(() => {
    setActive(0);
  }, [search]);

  const pick = (userId: string) => {
    if (openDm.isPending) return;
    openDm.mutate(userId, {
      onSuccess: (channel) => {
        onOpenChange(false);
        navigate(`/w/${workspaceId}/chat/${channel.id}`);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Pick a teammate to start a direct message.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search people"
            className="pl-8"
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="dm-people"
            aria-activedescendant={people[active] ? `dm-person-${people[active].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, people.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const p = people[active];
                if (p) pick(p.id);
              }
            }}
          />
        </div>
        <ul id="dm-people" role="listbox" aria-label="People" className="max-h-80 space-y-0.5 overflow-y-auto scrollbar-thin -mx-1 px-1" aria-busy={members.isPending}>
          {members.isPending
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <Skeleton className="size-7 rounded-full" />
                  <Skeleton className="h-3.5 w-32" />
                </li>
              ))
            : people.map((u, i) => <PersonRow key={u.id} user={u} active={i === active} onPick={() => pick(u.id)} onHover={() => setActive(i)} />)}
          {!members.isPending && people.length === 0 ? (
            <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">No one matches “{search}”.</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({
  user,
  active,
  onPick,
  onHover,
}: {
  user: { id: string; name: string; email: string; avatarUrl: string | null; title: string | null };
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const presence = usePresence(user.id);
  return (
    <li
      id={`dm-person-${user.id}`}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <UserAvatar user={user} size="md" showPresence />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{user.name}</div>
        <div className="truncate text-2xs text-muted-foreground">{user.title ?? user.email}</div>
      </div>
      <span className="text-2xs capitalize text-muted-foreground">{presence}</span>
    </li>
  );
}
