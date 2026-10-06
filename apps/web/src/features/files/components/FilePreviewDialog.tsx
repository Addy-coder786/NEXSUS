import { Download, ExternalLink } from 'lucide-react';
import type { FileDto } from '@nexus/shared';
import { formatBytes } from '../utils';
import { FileIcon } from './FileIcon';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';

interface FilePreviewDialogProps {
  file: FileDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilePreviewDialog({ file, open, onOpenChange }: FilePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0" aria-describedby={undefined}>
        {file ? (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
              <FileIcon kind={file.kind} className="size-4" />
              <DialogTitle className="truncate text-sm">{file.name}</DialogTitle>
              <DialogDescription className="ml-auto hidden shrink-0 text-xs sm:block">
                {formatBytes(file.size)} · {file.uploadedBy.name} · {formatDateTime(file.createdAt)}
              </DialogDescription>
            </div>
            <div className="flex max-h-[75vh] min-h-64 items-center justify-center overflow-auto bg-muted/40 p-4">
              <PreviewBody file={file} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
              <Button variant="outline" size="sm" asChild>
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open in new tab
                </a>
              </Button>
              <Button size="sm" asChild>
                <a href={file.url} download={file.name}>
                  <Download /> Download
                </a>
              </Button>
            </div>
          </>
        ) : (
          <div className="p-6">
            <DialogTitle className="sr-only">Loading file</DialogTitle>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ file }: { file: FileDto }) {
  switch (file.kind) {
    case 'image':
      return <img src={file.url} alt={file.name} className="max-h-[70vh] max-w-full rounded-md object-contain" />;
    case 'pdf':
      return (
        <object data={file.url} type="application/pdf" className="h-[70vh] w-full rounded-md" aria-label={file.name}>
          <iframe src={file.url} title={file.name} className="h-[70vh] w-full rounded-md" />
        </object>
      );
    case 'video':
      return (
        <video src={file.url} controls className="max-h-[70vh] max-w-full rounded-md" aria-label={file.name}>
          Your browser cannot play this video.
        </video>
      );
    case 'audio':
      return (
        <div className="flex w-full max-w-md flex-col items-center gap-4 py-8">
          <FileIcon kind="audio" className="size-12" />
          <audio src={file.url} controls className="w-full" aria-label={file.name} />
        </div>
      );
    default:
      return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileIcon kind={file.kind} className="size-12" />
          <p className="text-sm font-medium">No preview available</p>
          <p className="text-xs text-muted-foreground">
            {file.mimeType} · {formatBytes(file.size)}
          </p>
          <Button asChild size="sm">
            <a href={file.url} download={file.name}>
              <Download /> Download file
            </a>
          </Button>
        </div>
      );
  }
}
