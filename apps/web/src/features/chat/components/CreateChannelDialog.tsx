import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { createChannelSchema } from '@nexus/shared';
import { useCreateChannel } from '../hooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/common/FormField';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useMembers } from '@/features/workspaces/hooks';
import { useAuthStore } from '@/stores/auth.store';
import { getErrorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Visibility = 'PUBLIC' | 'PRIVATE';

export function CreateChannelDialog({ workspaceId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const myId = useAuthStore((s) => s.user?.id);
  const create = useCreateChannel(workspaceId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<Visibility>('PUBLIC');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const members = useMembers(open && type === 'PRIVATE' ? workspaceId : undefined);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setType('PUBLIC');
      setMemberIds([]);
      setMemberSearch('');
      setErrors({});
    }
  }, [open]);

  const candidates = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return (members.data ?? [])
      .filter((m) => m.user.id !== myId)
      .filter((m) => !q || m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q));
  }, [members.data, memberSearch, myId]);

  const submit = () => {
    const parsed = createChannelSchema.safeParse({
      name,
      description: description.trim() || undefined,
      type,
      memberIds: type === 'PRIVATE' ? memberIds : undefined,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (channel) => {
        toast.success(`#${channel.slug} created`);
        onOpenChange(false);
        navigate(`/w/${workspaceId}/chat/${channel.id}`);
      },
      onError: (error) => {
        if (isApiError(error) && error.status === 409) setErrors({ name: 'A channel with this name already exists.' });
        else toast.error(getErrorMessage(error));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>Channels keep conversations organised around a topic.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormField id="new-channel-name" label="Name" required error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. design-reviews" maxLength={60} autoFocus />
          </FormField>
          <FormField id="new-channel-description" label="Topic" error={errors.description}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this channel about?" maxLength={300} rows={2} />
          </FormField>

          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Visibility</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'PUBLIC', label: 'Public', hint: 'Anyone in the workspace', Icon: Hash },
                  { value: 'PRIVATE', label: 'Private', hint: 'Only invited people', Icon: Lock },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[13px] hover:bg-accent',
                    type === opt.value && 'border-primary bg-primary/5',
                  )}
                >
                  <input
                    type="radio"
                    name="channel-visibility"
                    value={opt.value}
                    checked={type === opt.value}
                    onChange={() => setType(opt.value)}
                    className="sr-only"
                  />
                  <opt.Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {type === 'PRIVATE' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">Members</span>
                <span className="text-xs text-muted-foreground">{memberIds.length} selected</span>
              </div>
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search people"
                aria-label="Search people"
                className="h-7 text-xs"
              />
              <ul className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1 scrollbar-thin" aria-busy={members.isPending}>
                {candidates.map((m) => {
                  const checked = memberIds.includes(m.user.id);
                  return (
                    <li key={m.user.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-accent">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setMemberIds((prev) => (v ? [...prev, m.user.id] : prev.filter((id) => id !== m.user.id)))
                          }
                          aria-label={m.user.name}
                        />
                        <UserAvatar user={m.user} size="xs" />
                        <span className="truncate">{m.user.name}</span>
                        <span className="ml-auto truncate text-2xs text-muted-foreground">{m.user.email}</span>
                      </label>
                    </li>
                  );
                })}
                {!members.isPending && candidates.length === 0 ? (
                  <li className="px-1.5 py-1 text-xs text-muted-foreground">No people found</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
