import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';
import type { FileKind } from '@nexus/shared';
import { cn } from '@/lib/utils';

const ICONS: Record<FileKind, React.ComponentType<{ className?: string }>> = {
  image: FileImage,
  pdf: FileText,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
  other: File,
};

const TINTS: Record<FileKind, string> = {
  image: 'text-chart-3',
  pdf: 'text-destructive',
  video: 'text-chart-5',
  audio: 'text-chart-4',
  document: 'text-chart-1',
  archive: 'text-chart-2',
  other: 'text-muted-foreground',
};

export function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <span data-kind={kind} className={cn('inline-flex shrink-0 items-center justify-center', TINTS[kind], className)} aria-hidden>
      <Icon className="size-full" />
    </span>
  );
}
