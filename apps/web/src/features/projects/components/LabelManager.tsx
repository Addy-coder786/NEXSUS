import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { HEX_COLOR_REGEX, type LabelDto } from '@nexus/shared';
import { useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from '../hooks';
import { ColorPicker, PROJECT_COLORS } from './ColorPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { getErrorMessage } from '@/lib/api';

interface LabelManagerProps {
  projectId: string;
  canEdit: boolean;
}

export function LabelManager({ projectId, canEdit }: LabelManagerProps) {
  const labels = useLabels(projectId);
  const create = useCreateLabel(projectId);
  const update = useUpdateLabel(projectId);
  const remove = useDeleteLabel(projectId);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [deleting, setDeleting] = useState<LabelDto | null>(null);

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !HEX_COLOR_REGEX.test(color)) return;
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          setName('');
          toast.success('Label created');
        },
        onError: (err) => toast.error(getErrorMessage(err)),
      },
    );
  };

  return (
    <div className="space-y-3">
      {labels.isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : (labels.data?.length ?? 0) === 0 ? (
        <p className="text-[13px] text-muted-foreground">No labels yet. Labels help categorise tasks on the board.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {(labels.data ?? []).map((l) => {
            const isEditing = editing?.id === l.id;
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                {isEditing ? (
                  <form
                    className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(
                        { labelId: l.id, name: editing.name.trim(), color: editing.color },
                        {
                          onSuccess: () => {
                            setEditing(null);
                            toast.success('Label updated');
                          },
                          onError: (err) => toast.error(getErrorMessage(err)),
                        },
                      );
                    }}
                  >
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      aria-label="Label name"
                      className="h-7 sm:w-48"
                      maxLength={30}
                      autoFocus
                    />
                    <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                    <div className="ml-auto flex gap-1">
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                        <X />
                      </Button>
                      <Button type="submit" size="sm" loading={update.isPending} disabled={!editing.name.trim()}>
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className="size-3 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                    <span className="flex-1 font-medium">{l.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{l.color}</span>
                    {canEdit ? (
                      <div className="flex gap-1">
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${l.name}`} onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })}>
                          <Pencil />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${l.name}`} className="text-destructive" onClick={() => setDeleting(l)}>
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={onCreate} className="flex flex-col gap-2 rounded-md border border-dashed p-3 sm:flex-row sm:items-center">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New label name"
            aria-label="New label name"
            className="h-7 sm:w-48"
            maxLength={30}
          />
          <ColorPicker value={color} onChange={setColor} />
          <Button type="submit" size="sm" className="sm:ml-auto" loading={create.isPending} disabled={!name.trim()}>
            <Plus /> Add label
          </Button>
        </form>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete label "${deleting?.name ?? ''}"?`}
        description="The label will be removed from every task that uses it."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success('Label deleted');
            },
            onError: (err) => toast.error(getErrorMessage(err)),
          });
        }}
      />
    </div>
  );
}
