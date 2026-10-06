import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { Upload, X } from 'lucide-react';
import type { FileDto, UploadFileFields } from '@nexus/shared';
import { MAX_FILE_SIZE_BYTES } from '@nexus/shared';
import { useUploadFile } from '../hooks';
import { ACCEPT_ATTRIBUTE, formatBytes, kindFromMime, precheckFile } from '../utils';
import { FileIcon } from './FileIcon';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface FileUploaderProps {
  workspaceId: string;
  fields?: UploadFileFields;
  onUploaded?: (file: FileDto) => void;
  /** Compact renders a single-line button + list, for drawers. */
  compact?: boolean;
  className?: string;
  disabled?: boolean;
}

let seq = 0;

export function FileUploader({ workspaceId, fields, onUploaded, compact = false, className, disabled }: FileUploaderProps) {
  const upload = useUploadFile(workspaceId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const runningRef = useRef(false);
  const id = useId();

  const patch = (itemId: string, p: Partial<QueueItem>) =>
    setQueue((q) => q.map((it) => (it.id === itemId ? { ...it, ...p } : it)));

  const processQueue = useCallback(
    async (items: QueueItem[]) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        for (const item of items) {
          patch(item.id, { status: 'uploading', progress: 0 });
          try {
            const result = await upload.mutateAsync({
              file: item.file,
              fields,
              onProgress: (fraction) => patch(item.id, { progress: fraction }),
            });
            patch(item.id, { status: 'done', progress: 1 });
            onUploaded?.(result);
          } catch (err) {
            patch(item.id, { status: 'error', error: getErrorMessage(err, 'Upload failed') });
          }
        }
      } finally {
        runningRef.current = false;
        // Clear finished items after a moment so the list does not grow forever.
        setTimeout(() => setQueue((q) => q.filter((it) => it.status !== 'done')), 2500);
      }
    },
    [upload, fields, onUploaded],
  );

  const addFiles = (list: FileList | File[] | null) => {
    if (!list || disabled) return;
    const next: QueueItem[] = [];
    const valid: QueueItem[] = [];
    for (const file of Array.from(list)) {
      seq += 1;
      const check = precheckFile(file);
      const item: QueueItem = {
        id: `${Date.now()}-${seq}`,
        file,
        progress: 0,
        status: check.ok ? 'queued' : 'error',
        error: check.ok ? undefined : check.reason,
      };
      next.push(item);
      if (check.ok) valid.push(item);
    }
    setQueue((q) => [...q, ...next]);
    if (valid.length) void processQueue(valid);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const input = (
    <input
      ref={inputRef}
      id={`${id}-input`}
      type="file"
      multiple
      accept={ACCEPT_ATTRIBUTE}
      className="sr-only"
      disabled={disabled}
      onChange={(e) => {
        addFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {compact ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('rounded-md transition-colors', dragging && 'bg-primary/10 ring-2 ring-primary/40')}
        >
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
            <Upload /> Attach files
          </Button>
          {input}
        </div>
      ) : (
        <label
          htmlFor={`${id}-input`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
            'hover:border-foreground/30 hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring',
            dragging && 'border-primary bg-primary/10',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Upload className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-medium">Drop files here or click to browse</span>
          <span className="text-xs text-muted-foreground">
            Images, PDFs, media, office documents and archives up to {formatBytes(MAX_FILE_SIZE_BYTES, 0)} each.
          </span>
          {input}
        </label>
      )}

      {queue.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Uploads" aria-live="polite">
          {queue.map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs">
              <FileIcon kind={kindFromMime(it.file.type, it.file.name)} className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{it.file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {it.status === 'error'
                      ? 'Failed'
                      : it.status === 'done'
                        ? 'Uploaded'
                        : it.status === 'uploading'
                          ? `${Math.round(it.progress * 100)}%`
                          : formatBytes(it.file.size)}
                  </span>
                </span>
                {it.status === 'error' ? (
                  <span role="alert" className="block text-destructive">
                    {it.error}
                  </span>
                ) : (
                  <Progress value={it.progress * 100} size="sm" className="mt-1" aria-label={`Uploading ${it.file.name}`} />
                )}
              </span>
              {it.status === 'error' || it.status === 'queued' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Dismiss ${it.file.name}`}
                  onClick={() => setQueue((q) => q.filter((x) => x.id !== it.id))}
                >
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
