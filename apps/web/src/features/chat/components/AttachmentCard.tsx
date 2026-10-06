import { Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';
import type { FileDto, FileKind } from '@nexus/shared';
import { formatFileSize, resolveFileUrl } from '../utils';
import { cn } from '@/lib/utils';

const iconByKind: Record<FileKind, typeof File> = {
  image: FileImage,
  pdf: FileText,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  other: File,
};

/** Compact attachment preview used inside chat messages. */
export function AttachmentCard({ file, className }: { file: FileDto; className?: string }) {
  const url = resolveFileUrl(file.url);
  if (file.kind === 'image') {
    const thumb = resolveFileUrl(file.thumbnailUrl ?? file.url);
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'group/att relative block max-w-[320px] overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label={`Open image ${file.name}`}
      >
        <img
          src={thumb}
          alt={file.name}
          loading="lazy"
          className="block max-h-60 w-auto max-w-full object-contain"
          width={file.width ?? undefined}
          height={file.height ?? undefined}
        />
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-2xs text-white opacity-0 transition-opacity group-hover/att:opacity-100">
          {file.name} · {formatFileSize(file.size)}
        </span>
      </a>
    );
  }
  const Icon = iconByKind[file.kind] ?? File;
  return (
    <div
      className={cn(
        'flex max-w-[320px] items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 text-[13px]',
        className,
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={file.name}>
          {file.name}
        </div>
        <div className="text-2xs text-muted-foreground">{formatFileSize(file.size)}</div>
      </div>
      <a
        href={url}
        download={file.name}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Download ${file.name}`}
      >
        <Download className="size-4" aria-hidden />
      </a>
    </div>
  );
}
