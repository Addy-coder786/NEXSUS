import { useState } from 'react';
import { Download, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { FileDto } from '@nexus/shared';
import { formatBytes } from '../utils';
import { FileIcon } from './FileIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface FileActions {
  onPreview: (file: FileDto) => void;
  onRename?: (file: FileDto, name: string) => void;
  onDelete?: (file: FileDto) => void;
  /** Whether the current user may rename/delete this particular file. */
  canManage: (file: FileDto) => boolean;
}

/** Shared action menu for rows and cards. */
export function FileMenu({ file, actions, className }: { file: FileDto; actions: FileActions; className?: string }) {
  const manage = actions.canManage(file);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${file.name}`} className={className}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => actions.onPreview(file)}>
          <Eye /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={file.url} download={file.name}>
            <Download /> Download
          </a>
        </DropdownMenuItem>
        {manage && actions.onRename ? (
          <DropdownMenuItem onSelect={() => actions.onRename?.(file, '')}>
            <Pencil /> Rename
          </DropdownMenuItem>
        ) : null}
        {manage && actions.onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => actions.onDelete?.(file)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Splits "report.final.pdf" into ["report.final", ".pdf"] so renaming keeps the extension. */
export function splitName(name: string): [string, string] {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return [name, ''];
  return [name.slice(0, idx), name.slice(idx)];
}

export function RenameInput({
  file,
  onCommit,
  onCancel,
}: {
  file: FileDto;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [base, ext] = splitName(file.name);
  const [value, setValue] = useState(base);
  const commit = () => {
    const next = value.trim();
    if (!next || next === base) {
      onCancel();
      return;
    }
    onCommit(`${next}${ext}`);
  };
  return (
    <span className="flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        aria-label="File name"
        className="h-7 text-xs"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {ext ? <span className="text-xs text-muted-foreground">{ext}</span> : null}
    </span>
  );
}

interface FileRowProps {
  file: FileDto;
  actions: FileActions;
  renaming?: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
  showProject?: boolean;
  projectName?: string;
}

export function FileRow({ file, actions, renaming = false, onRenameCommit, onRenameCancel, showProject, projectName }: FileRowProps) {
  return (
    <tr
      data-testid="file-row"
      className={cn('group border-b transition-colors last:border-0 hover:bg-muted/40')}
    >
      <td className="py-2 pl-6 pr-3">
        <div className="flex items-center gap-2.5">
          {file.kind === 'image' && (file.thumbnailUrl || file.url) ? (
            <img
              src={file.thumbnailUrl ?? file.url}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              className="size-8 shrink-0 rounded-md border object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50">
              <FileIcon kind={file.kind} className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            {renaming && onRenameCommit && onRenameCancel ? (
              <RenameInput file={file} onCommit={onRenameCommit} onCancel={onRenameCancel} />
            ) : (
              <button
                type="button"
                className="block max-w-full truncate text-left text-[13px] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => actions.onPreview(file)}
              >
                {file.name}
              </button>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {file.mimeType}
              {showProject && projectName ? ` · ${projectName}` : ''}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <UserAvatar user={file.uploadedBy} size="xs" />
          <span className="truncate">{file.uploadedBy.name}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground" title={formatDateTime(file.createdAt)}>
        {formatRelative(file.createdAt)}
      </td>
      <td className="py-2 pl-3 pr-6 text-right">
        <FileMenu file={file} actions={actions} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
      </td>
    </tr>
  );
}
