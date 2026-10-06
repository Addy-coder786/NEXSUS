import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { FileDto } from '@nexus/shared';
import { useDeleteFile, useFile, useFiles, useRenameFile } from '../hooks';
import type { FileFilters as ApiFileFilters } from '../api';
import { FileFilters, type FileFilterState } from './FileFilters';
import { FileGrid, type FileView } from './FileGrid';
import { FilePreviewDialog } from './FilePreviewDialog';
import { FileUploader } from './FileUploader';
import { StorageUsageBar } from './StorageUsageBar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { usePermissions } from '@/lib/permissions';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';

interface FilesBrowserProps {
  workspaceId: string;
  /** Scope to a project (project Files tab); hides the project filter. */
  projectId?: string;
  /** Show the storage meter (workspace page only). */
  showUsage?: boolean;
}

function readView(): FileView {
  try {
    return (localStorage.getItem('nexus-files-view') as FileView | null) ?? 'grid';
  } catch {
    return 'grid';
  }
}

export function FilesBrowser({ workspaceId, projectId, showUsage = false }: FilesBrowserProps) {
  const me = useAuthStore((s) => s.user);
  const { can } = usePermissions();
  const canUpload = can('file:upload');
  const canDeleteAny = can('file:delete');
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<FileFilterState>({ search: '', kind: '', projectId: '', sort: 'createdAt' });
  const debouncedSearch = useDebouncedValue(filters.search.trim(), 300);
  const [view, setView] = useState<FileView>(readView);
  const [showUploader, setShowUploader] = useState(false);
  const [deleting, setDeleting] = useState<FileDto | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('nexus-files-view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const projects = useWorkspaceProjects(projectId ? undefined : workspaceId);
  const projectNames = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);

  const apiFilters: ApiFileFilters = useMemo(() => {
    const f: ApiFileFilters = { sort: filters.sort, order: filters.sort === 'name' ? 'asc' : 'desc', limit: 100 };
    if (debouncedSearch) f.search = debouncedSearch;
    if (filters.kind) f.kind = filters.kind;
    if (projectId) f.projectId = projectId;
    else if (filters.projectId) f.projectId = filters.projectId;
    return f;
  }, [filters.sort, filters.kind, filters.projectId, debouncedSearch, projectId]);

  const files = useFiles(workspaceId, apiFilters);
  const rename = useRenameFile();
  const remove = useDeleteFile();

  // `?file=:id` opens the preview (used by search and notifications).
  const previewId = params.get('file');
  const previewFromList = files.data?.items.find((f) => f.id === previewId) ?? null;
  const previewFetched = useFile(previewId && !previewFromList ? previewId : null);
  const previewFile = previewFromList ?? previewFetched.data ?? null;
  const openPreview = (file: FileDto) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('file', file.id);
      return next;
    });
  const closePreview = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('file');
        return next;
      },
      { replace: true },
    );
  const previewMissing = Boolean(previewId) && previewFetched.isError;
  useEffect(() => {
    if (!previewMissing) return;
    toast.error('File not found');
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('file');
        return next;
      },
      { replace: true },
    );
  }, [previewMissing, setParams]);

  const canManage = (file: FileDto) => canDeleteAny || file.uploadedBy.id === me?.id;
  const items = files.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileFilters
        value={filters}
        onChange={setFilters}
        projects={projectId ? undefined : projects.data}
        view={view}
        onViewChange={setView}
        trailing={
          canUpload ? (
            <Button size="sm" variant={showUploader ? 'secondary' : 'default'} onClick={() => setShowUploader((s) => !s)} aria-expanded={showUploader}>
              <Upload /> Upload
            </Button>
          ) : null
        }
      />
      {(showUploader && canUpload) || showUsage ? (
        <div className="flex flex-col gap-3 border-b px-6 py-3">
          {showUsage ? <StorageUsageBar workspaceId={workspaceId} className="max-w-sm" /> : null}
          {showUploader && canUpload ? (
            <FileUploader workspaceId={workspaceId} fields={projectId ? { projectId } : undefined} />
          ) : null}
        </div>
      ) : null}

      <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin', files.isFetching && !files.isPending && 'opacity-80')}>
        {files.isPending ? (
          <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        ) : files.isError ? (
          <p role="alert" className="p-6 text-[13px] text-destructive">
            {files.error.message}
          </p>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FolderOpen />}
              title={debouncedSearch || filters.kind ? 'No files match' : 'No files yet'}
              description={
                debouncedSearch || filters.kind
                  ? 'Try a different search or type filter.'
                  : 'Upload images, PDFs, media and documents to share them with the team.'
              }
              action={
                canUpload && !showUploader && !debouncedSearch ? (
                  <Button size="sm" onClick={() => setShowUploader(true)}>
                    <Upload /> Upload files
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <FileGrid
            files={items}
            view={view}
            showProject={!projectId}
            projectNames={projectNames}
            actions={{
              onPreview: openPreview,
              canManage,
              onRename: (file, name) =>
                rename.mutate(
                  { id: file.id, name },
                  {
                    onSuccess: () => toast.success('File renamed'),
                    onError: (e) => toast.error(getErrorMessage(e)),
                  },
                ),
              onDelete: (file) => setDeleting(file),
            }}
          />
        )}
      </div>

      <FilePreviewDialog file={previewFile} open={Boolean(previewId)} onOpenChange={(o) => !o && closePreview()} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="The file will be removed from the workspace and any task or message it is attached to."
        confirmLabel="Delete file"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting, {
            onSuccess: () => {
              toast.success('File deleted');
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </div>
  );
}
