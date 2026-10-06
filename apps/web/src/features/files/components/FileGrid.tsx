import { useState } from 'react';
import type { FileDto } from '@nexus/shared';
import { formatBytes } from '../utils';
import { FileIcon } from './FileIcon';
import { FileMenu, FileRow, RenameInput, type FileActions } from './FileRow';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';

export type FileView = 'grid' | 'list';

interface FileGridProps {
  files: FileDto[];
  view: FileView;
  actions: Omit<FileActions, 'onRename'> & { onRename?: (file: FileDto, name: string) => void };
  showProject?: boolean;
  projectNames?: Map<string, string>;
}

/** Renders files either as a card grid or as a table, with inline rename. */
export function FileGrid({ files, view, actions, showProject, projectNames }: FileGridProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const wired: FileActions = {
    ...actions,
    onRename: actions.onRename ? (file) => setRenamingId(file.id) : undefined,
  };
  const commitRename = (file: FileDto) => (name: string) => {
    setRenamingId(null);
    actions.onRename?.(file, name);
  };

  if (view === 'list') {
    return (
      <div className="w-full overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="h-9 pl-6 pr-3 font-semibold">Name</th>
              <th scope="col" className="h-9 w-24 px-3 font-semibold">Size</th>
              <th scope="col" className="h-9 w-44 px-3 font-semibold">Uploaded by</th>
              <th scope="col" className="h-9 w-32 px-3 font-semibold">Date</th>
              <th scope="col" className="h-9 w-14 pl-3 pr-6">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                actions={wired}
                renaming={renamingId === f.id}
                onRenameCommit={commitRename(f)}
                onRenameCancel={() => setRenamingId(null)}
                showProject={showProject}
                projectName={f.projectId ? projectNames?.get(f.projectId) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-label="Files">
      {files.map((f) => (
        <li key={f.id} className="group relative flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-foreground/20">
          <button
            type="button"
            onClick={() => actions.onPreview(f)}
            aria-label={`Preview ${f.name}`}
            className="flex aspect-[4/3] w-full items-center justify-center bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {f.kind === 'image' ? (
              <img src={f.thumbnailUrl ?? f.url} alt={f.name} loading="lazy" className="size-full object-cover" />
            ) : (
              <FileIcon kind={f.kind} className="size-10" />
            )}
          </button>
          <div className="flex items-start gap-1 p-2.5">
            <div className="min-w-0 flex-1">
              {renamingId === f.id && actions.onRename ? (
                <RenameInput file={f} onCommit={commitRename(f)} onCancel={() => setRenamingId(null)} />
              ) : (
                <p className="truncate text-[13px] font-medium" title={f.name}>
                  {f.name}
                </p>
              )}
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground" title={formatDateTime(f.createdAt)}>
                <UserAvatar user={f.uploadedBy} size="xs" />
                <span className="truncate">{f.uploadedBy.name}</span>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">{formatBytes(f.size)}</span>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">{formatRelative(f.createdAt)}</span>
              </p>
            </div>
            <FileMenu file={f} actions={wired} className="-mr-1 -mt-0.5 shrink-0" />
          </div>
        </li>
      ))}
    </ul>
  );
}
