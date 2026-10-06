import { useState } from 'react';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FileDto } from '@nexus/shared';
import { useDeleteFile, useTaskFiles } from '../hooks';
import { formatBytes } from '../utils';
import { FileIcon } from './FileIcon';
import { FilePreviewDialog } from './FilePreviewDialog';
import { FileUploader } from './FileUploader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePermissions } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';

interface TaskAttachmentsProps {
  taskId: string;
  projectId: string;
  workspaceId: string;
}

/** Compact attachment list + uploader for the task drawer. */
export function TaskAttachments({ taskId, projectId, workspaceId }: TaskAttachmentsProps) {
  const me = useAuthStore((s) => s.user);
  const { can } = usePermissions();
  const canUpload = can('file:upload');
  const canDeleteAny = can('file:delete');
  const files = useTaskFiles(taskId);
  const remove = useDeleteFile();
  const [preview, setPreview] = useState<FileDto | null>(null);
  const [deleting, setDeleting] = useState<FileDto | null>(null);
  const count = files.data?.length ?? 0;

  return (
    <section className="space-y-2" aria-labelledby={`attachments-${taskId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`attachments-${taskId}`} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Paperclip className="size-3.5" aria-hidden />
          Attachments
          {count > 0 ? <span className="font-normal normal-case tracking-normal">({count})</span> : null}
        </h3>
        {canUpload ? <FileUploader workspaceId={workspaceId} fields={{ taskId, projectId }} compact /> : null}
      </div>
      {files.isPending ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : files.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {files.error.message}
        </p>
      ) : count === 0 ? (
        <p className="text-xs text-muted-foreground">No attachments yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {files.data?.map((f) => {
            const canManage = canDeleteAny || f.uploadedBy.id === me?.id;
            return (
              <li key={f.id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px]">
                {f.kind === 'image' ? (
                  <img src={f.thumbnailUrl ?? f.url} alt="" width={28} height={28} className="size-7 shrink-0 rounded border object-cover" />
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted/50">
                    <FileIcon kind={f.kind} className="size-3.5" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="min-w-0 flex-1 truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {f.name}
                </button>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {formatBytes(f.size)} · {f.uploadedBy.name} · {formatRelative(f.createdAt)}
                </span>
                <SimpleTooltip label="Download">
                  <Button variant="ghost" size="icon-sm" asChild aria-label={`Download ${f.name}`}>
                    <a href={f.url} download={f.name}>
                      <Download />
                    </a>
                  </Button>
                </SimpleTooltip>
                {canManage ? (
                  <SimpleTooltip label="Remove">
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`} className="text-destructive" onClick={() => setDeleting(f)}>
                      <Trash2 />
                    </Button>
                  </SimpleTooltip>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <FilePreviewDialog file={preview} open={preview !== null} onOpenChange={(o) => !o && setPreview(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Remove "${deleting?.name ?? ''}"?`}
        description="The file is deleted from the workspace, not just detached from this task."
        confirmLabel="Delete file"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting, {
            onSuccess: () => {
              toast.success('Attachment removed');
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </section>
  );
}
