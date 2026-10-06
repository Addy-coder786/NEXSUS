import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Bell, BellOff, Hash, Lock, Menu, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { updateChannelSchema, type ChannelDto } from '@nexus/shared';
import { useChannelMembers, useDeleteChannel, useMuteChannel, useUpdateChannel } from '../hooks';
import { isGeneralChannel } from '../utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FormField } from '@/components/common/FormField';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useAuthStore } from '@/stores/auth.store';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface ChannelHeaderProps {
  channel: ChannelDto;
  workspaceId: string;
  /** Shown on narrow screens to reveal the channel list. */
  onShowChannels?: () => void;
  className?: string;
}

export function ChannelHeader({ channel, workspaceId, onShowChannels, className }: ChannelHeaderProps) {
  const navigate = useNavigate();
  const myId = useAuthStore((s) => s.user?.id);
  const canManage = useCan('channel:manage');
  const canEdit = channel.type !== 'DM' && (canManage || channel.createdBy === myId);
  const canDelete = canManage && channel.type !== 'DM' && !channel.projectId && !isGeneralChannel(channel);
  const muted = channel.muted;
  const mute = useMuteChannel();
  const update = useUpdateChannel();
  const remove = useDeleteChannel();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isDm = channel.type === 'DM';
  const other = isDm ? channel.participants?.[0] : undefined;

  return (
    <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b px-3', className)}>
      {onShowChannels ? (
        <Button variant="ghost" size="icon-sm" aria-label="Show channels" onClick={onShowChannels} className="lg:hidden">
          <Menu />
        </Button>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isDm ? (
          <UserAvatar user={other ?? { name: channel.name, avatarUrl: null }} size="sm" showPresence />
        ) : channel.type === 'PRIVATE' ? (
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : channel.type === 'GROUP' ? (
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <h1 className="truncate text-sm font-semibold">{channel.name}</h1>
        {channel.source === 'slack' ? <Badge variant="outline">Slack</Badge> : null}
        {channel.isReadOnly ? <Badge variant="secondary">Read-only</Badge> : null}
        {channel.isArchived ? <Badge variant="warning">Archived</Badge> : null}
        {channel.description ? (
          <>
            <span className="hidden text-muted-foreground md:inline" aria-hidden>
              ·
            </span>
            <p className="hidden min-w-0 truncate text-[13px] text-muted-foreground md:block" title={channel.description}>
              {channel.description}
            </p>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {!isDm ? <MembersPopover channel={channel} /> : null}
        <SimpleTooltip label={muted ? 'Unmute channel' : 'Mute channel'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={muted ? 'Unmute channel' : 'Mute channel'}
            aria-pressed={muted}
            onClick={() => mute.mutate({ channelId: channel.id, muted: !muted })}
            className={cn(muted && 'text-muted-foreground')}
          >
            {muted ? <BellOff /> : <Bell />}
          </Button>
        </SimpleTooltip>
        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Channel options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit ? (
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil /> Edit channel
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <DropdownMenuItem
                  onSelect={() =>
                    update.mutate(
                      { channelId: channel.id, isArchived: !channel.isArchived },
                      { onSuccess: () => toast.success(channel.isArchived ? 'Channel unarchived' : 'Channel archived') },
                    )
                  }
                >
                  {channel.isArchived ? <ArchiveRestore /> : <Archive />}
                  {channel.isArchived ? 'Unarchive channel' : 'Archive channel'}
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete channel
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {canEdit ? <EditChannelDialog channel={channel} open={editOpen} onOpenChange={setEditOpen} /> : null}
      {canDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete #${channel.slug}?`}
          description="All messages in this channel will be permanently deleted. This cannot be undone."
          confirmLabel="Delete channel"
          destructive
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(channel, {
              onSuccess: () => {
                setDeleteOpen(false);
                toast.success('Channel deleted');
                navigate(`/w/${workspaceId}/chat`, { replace: true });
              },
            })
          }
        />
      ) : null}
    </header>
  );
}

function MembersPopover({ channel }: { channel: ChannelDto }) {
  const [open, setOpen] = useState(false);
  const members = useChannelMembers(open ? channel.id : undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${channel.memberCount} members`} className="gap-1 text-muted-foreground">
          <Users className="size-3.5" aria-hidden />
          <span className="tabular-nums">{channel.memberCount}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Members</div>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto scrollbar-thin" aria-busy={members.isPending}>
          {members.isPending
            ? Array.from({ length: 4 }).map((_, i) => <li key={i} className="h-7 animate-pulse rounded bg-muted" />)
            : (members.data ?? []).map((m) => (
                <li key={m.user.id} className="flex items-center gap-2 rounded px-1 py-1 text-[13px]">
                  <UserAvatar user={m.user} size="sm" showPresence />
                  <span className="truncate">{m.user.name}</span>
                  <span className="ml-auto text-2xs text-muted-foreground">{m.role.toLowerCase()}</span>
                </li>
              ))}
          {!members.isPending && (members.data?.length ?? 0) === 0 ? (
            <li className="px-1 py-1 text-xs text-muted-foreground">No members</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function EditChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: ChannelDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateChannel();
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  const reset = () => {
    setName(channel.name);
    setDescription(channel.description ?? '');
    setErrors({});
  };

  const submit = () => {
    const parsed = updateChannelSchema.safeParse({ name, description: description.trim() || null });
    if (!parsed.success) {
      const next: { name?: string; description?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' || key === 'description') next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    update.mutate(
      { channelId: channel.id, ...parsed.data },
      {
        onSuccess: () => {
          toast.success('Channel updated');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit channel</DialogTitle>
          <DialogDescription>Change the name or topic of #{channel.slug}.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormField id="channel-name" label="Name" required error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          </FormField>
          <FormField id="channel-description" label="Topic" error={errors.description}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
