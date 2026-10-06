import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentDto } from '@nexus/shared';
import { useDocumentVersion, useDocumentVersions, useRestoreVersion } from '../hooks';
import { LazyReadOnlyDocument } from '../editor/LazyDocumentEditor';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface VersionHistoryDrawerProps {
  doc: DocumentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  /** Called after a successful restore so the editor reloads the new content. */
  onRestored: (doc: DocumentDto) => void;
}

export function VersionHistoryDrawer({ doc, open, onOpenChange, canRestore, onRestored }: VersionHistoryDrawerProps) {
  const versions = useDocumentVersions(doc.id, open);
  const [selected, setSelected] = useState<number | null>(null);
  const preview = useDocumentVersion(doc.id, open ? selected : null);
  const restore = useRestoreVersion(doc.id);
  const [confirm, setConfirm] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="max-w-4xl p-0" aria-describedby={undefined}>
        <div className="flex items-center gap-2 border-b px-5 py-3 pr-12">
          <History className="size-4 text-muted-foreground" aria-hidden />
          <DialogTitle className="text-sm">Version history</DialogTitle>
          <DialogDescription className="sr-only">Previous saved versions of {doc.title}</DialogDescription>
          <span className="ml-auto text-xs text-muted-foreground">Current: v{doc.version}</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
          <aside className="min-h-0 overflow-y-auto scrollbar-thin border-r bg-muted/30">
            {versions.isPending ? (
              <div className="space-y-2 p-3" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : versions.isError ? (
              <p role="alert" className="p-3 text-xs text-destructive">
                {versions.error.message}
              </p>
            ) : (versions.data?.length ?? 0) === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                No snapshots yet. A version is kept every time the content is saved.
              </p>
            ) : (
              <ul role="listbox" aria-label="Versions" className="p-2">
                {versions.data?.map((v) => {
                  const active = selected === v.version;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => setSelected(v.version)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active && 'bg-accent',
                        )}
                      >
                        <span className="flex items-center gap-2 text-[13px]">
                          <span className="font-medium">v{v.version}</span>
                          <span className="truncate text-muted-foreground">{v.title}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={formatDateTime(v.createdAt)}>
                          <UserAvatar user={v.savedBy} size="xs" />
                          {v.savedBy.name} · {formatRelative(v.createdAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
          <section className="flex min-h-0 flex-col">
            {selected === null ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState icon={<History />} title="Select a version" description="Preview any snapshot and restore it as the current content." className="border-0" />
              </div>
            ) : preview.isPending ? (
              <div className="p-6" aria-busy="true">
                <Skeleton className="mb-4 h-7 w-1/2" />
                <SkeletonLines lines={8} />
              </div>
            ) : preview.isError ? (
              <p role="alert" className="p-6 text-[13px] text-destructive">
                {preview.error.message}
              </p>
            ) : preview.data ? (
              <>
                <div className="flex items-center gap-3 border-b px-6 py-2 text-xs text-muted-foreground">
                  <span>
                    v{preview.data.version} · {formatDateTime(preview.data.createdAt)} · {preview.data.savedBy.name}
                  </span>
                  {canRestore && preview.data.version !== doc.version ? (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => setConfirm(true)}>
                      <RotateCcw /> Restore this version
                    </Button>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-8 py-6">
                  <h2 className="mb-4 text-2xl font-semibold tracking-tight">{preview.data.title}</h2>
                  <LazyReadOnlyDocument key={preview.data.version} content={preview.data.content} />
                </div>
              </>
            ) : null}
          </section>
        </div>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Restore version ${selected ?? ''}?`}
          description="The current content is kept in history, so you can always come back to it."
          confirmLabel="Restore"
          loading={restore.isPending}
          onConfirm={() => {
            if (selected === null) return;
            restore.mutate(selected, {
              onSuccess: (updated) => {
                toast.success(`Restored version ${selected}`);
                setConfirm(false);
                onOpenChange(false);
                setSelected(null);
                onRestored(updated);
              },
              onError: (e) => toast.error(getErrorMessage(e)),
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
