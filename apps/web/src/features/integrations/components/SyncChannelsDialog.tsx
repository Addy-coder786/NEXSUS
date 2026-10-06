import { useMemo, useState } from 'react';
import { Hash, Lock, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { SlackChannelOption } from '@nexus/shared';
import { useSlackChannels, useSyncSlackChannels } from '../hooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_PER_SYNC = 20;

export function SyncChannelsDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const channels = useSlackChannels(workspaceId, open);
  const sync = useSyncSlackChannels(workspaceId);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Map<string, SlackChannelOption>>(new Map());

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (channels.data ?? []).filter((c) => !f || c.name.toLowerCase().includes(f));
  }, [channels.data, filter]);

  const toggle = (c: SlackChannelOption) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else if (next.size < MAX_PER_SYNC) next.set(c.id, c);
      return next;
    });

  const close = (o: boolean) => {
    if (!o) {
      setSelected(new Map());
      setFilter('');
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sync Slack channels</DialogTitle>
          <DialogDescription>
            Messages from the selected channels are mirrored into read-only NEXUS channels. Up to {MAX_PER_SYNC} at a time.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels" aria-label="Filter channels" className="pl-8" />
        </div>
        <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-md border">
          {channels.isPending ? (
            <div className="space-y-2 p-2" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : channels.isError ? (
            <p role="alert" className="p-3 text-xs text-destructive">
              {channels.error.message}
            </p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No channels found.</p>
          ) : (
            <ul className="divide-y">
              {visible.map((c) => {
                const id = `sync-${c.id}`;
                const checked = selected.has(c.id);
                return (
                  <li key={c.id}>
                    <label
                      htmlFor={id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-accent/60',
                        c.alreadySynced && 'cursor-default opacity-60',
                      )}
                    >
                      <Checkbox id={id} checked={c.alreadySynced || checked} disabled={c.alreadySynced} onCheckedChange={() => toggle(c)} />
                      {c.isPrivate ? <Lock className="size-3.5 text-muted-foreground" aria-label="Private" /> : <Hash className="size-3.5 text-muted-foreground" aria-hidden />}
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.alreadySynced ? 'Synced' : `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.size === 0}
            loading={sync.isPending}
            onClick={() =>
              sync.mutate(
                { channels: Array.from(selected.values()).map((c) => ({ id: c.id, name: c.name })) },
                {
                  onSuccess: () => {
                    toast.success(`Syncing ${selected.size} ${selected.size === 1 ? 'channel' : 'channels'}`);
                    close(false);
                  },
                  onError: (e) => toast.error(getErrorMessage(e)),
                },
              )
            }
          >
            Sync channels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
