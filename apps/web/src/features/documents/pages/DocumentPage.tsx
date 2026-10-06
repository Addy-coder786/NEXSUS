import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { DocumentDto, RichContent, UpdateDocumentInput } from '@nexus/shared';
import { useDeleteDocument, useDocument, useDuplicateDocument, useUpdateDocument } from '../hooks';
import { useAutosave } from '../autosave';
import { extractText } from '../editor/extractText';
import { LazyDocumentEditor } from '../editor/LazyDocumentEditor';
import { DocumentHeader } from '../components/DocumentHeader';
import { ConflictBanner } from '../components/ConflictBanner';
import { VersionHistoryDrawer } from '../components/VersionHistoryDrawer';
import { useUploadFile } from '@/features/files/hooks';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton';
import { NotFound } from '@/components/common/NotFound';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { usePermissions } from '@/lib/permissions';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

export function DocumentPage() {
  const { workspaceId = '', documentId = '' } = useParams<{ workspaceId: string; documentId: string }>();
  const doc = useDocument(documentId);
  // Remount the editor after reload/restore so it picks up server content.
  const [editorKey, setEditorKey] = useState(0);

  if (doc.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-8" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-2/3" />
        <SkeletonLines lines={10} />
      </div>
    );
  }
  if (doc.isError || !doc.data) {
    const nf = isApiError(doc.error) && (doc.error.status === 404 || doc.error.status === 403);
    return (
      <NotFound
        title={nf ? 'Document not found' : 'Could not load document'}
        description={nf ? 'This document does not exist or you do not have access to it.' : doc.error?.message}
        to={`/w/${workspaceId}/docs`}
        actionLabel="Back to documents"
      />
    );
  }

  return (
    <DocumentView
      key={`${doc.data.id}:${editorKey}`}
      doc={doc.data}
      workspaceId={workspaceId}
      onReloaded={() => setEditorKey((k) => k + 1)}
    />
  );
}

function DocumentView({
  doc,
  workspaceId,
  onReloaded,
}: {
  doc: DocumentDto;
  workspaceId: string;
  onReloaded: () => void;
}) {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const { can } = usePermissions();
  const canUpdate = can('document:update');
  const canDelete = can('document:delete') || doc.createdBy.id === me?.id;
  const readOnly = !canUpdate || doc.isArchived;

  const projects = useWorkspaceProjects(workspaceId);
  const project = useMemo(
    () => (doc.projectId ? projects.data?.find((p) => p.id === doc.projectId) : undefined),
    [projects.data, doc.projectId],
  );

  const update = useUpdateDocument(doc.id);
  const duplicate = useDuplicateDocument();
  const remove = useDeleteDocument();
  const upload = useUploadFile(workspaceId);
  const query = useDocument(doc.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloading, setReloading] = useState(false);

  // The initial content is captured once per mount; `key` on DocumentView resets it.
  const [initialContent] = useState<RichContent>(doc.content);

  const save = useCallback((input: UpdateDocumentInput) => update.mutateAsync(input), [update.mutateAsync]);
  const autosave = useAutosave({
    initialVersion: doc.version,
    save,
    enabled: !readOnly,
    remoteVersion: query.data?.version,
  });

  const reload = async () => {
    setReloading(true);
    try {
      await query.refetch();
      update.dismissConflict();
      onReloaded();
    } finally {
      setReloading(false);
    }
  };

  const onEditorChange = (json: RichContent) => {
    autosave.markDirty({ content: json, contentText: extractText(json) });
  };

  const uploadImage = async (file: File) => {
    const result = await upload.mutateAsync({ file, fields: { documentId: doc.id } });
    return result.url;
  };

  const showConflict = autosave.status === 'conflict' || update.conflict !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DocumentHeader
        doc={doc}
        workspaceId={workspaceId}
        project={project}
        status={autosave.status}
        readOnly={readOnly}
        canDelete={canDelete}
        onTitleChange={(title) => autosave.markDirty({ title })}
        onIconChange={(icon) => autosave.markDirty({ icon })}
        onOpenHistory={() => setHistoryOpen(true)}
        onDuplicate={() =>
          duplicate.mutate(doc.id, {
            onSuccess: (copy) => {
              toast.success('Document duplicated');
              navigate(`/w/${workspaceId}/docs/${copy.id}`);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
        onToggleArchive={() => {
          void autosave.flush().then(() =>
            update.mutate(
              { isArchived: !doc.isArchived, baseVersion: autosave.baseVersion },
              {
                onSuccess: (updated) => {
                  toast.success(updated.isArchived ? 'Document archived' : 'Document restored');
                  onReloaded();
                },
                onError: (e) => {
                  if (!(isApiError(e) && e.status === 409)) toast.error(getErrorMessage(e));
                },
              },
            ),
          );
        }}
        onDelete={() => setConfirmDelete(true)}
      />
      {showConflict ? <ConflictBanner onReload={() => void reload()} loading={reloading} /> : null}
      {readOnly && !doc.isArchived ? (
        <p className="border-b bg-muted/40 px-6 py-1.5 text-xs text-muted-foreground" role="note">
          You have read-only access to this document.
        </p>
      ) : null}
      {doc.isArchived ? (
        <p className="border-b bg-muted/40 px-6 py-1.5 text-xs text-muted-foreground" role="note">
          This document is archived. Restore it to continue editing.
        </p>
      ) : null}
      {autosave.status === 'error' && autosave.error ? (
        <p role="alert" className="border-b bg-destructive/10 px-6 py-1.5 text-xs text-destructive">
          {autosave.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-3xl px-8 pb-24 pt-4">
          <LazyDocumentEditor
            content={initialContent}
            editable={!readOnly}
            onChange={onEditorChange}
            onUploadImage={can('file:upload') ? uploadImage : undefined}
          />
        </div>
      </div>

      <VersionHistoryDrawer
        doc={doc}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore={canUpdate && !doc.isArchived}
        onRestored={() => onReloaded()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${doc.title}"?`}
        description="The document and its version history will be removed. This cannot be undone."
        confirmLabel="Delete document"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(doc, {
            onSuccess: () => {
              toast.success('Document deleted');
              navigate(project ? `/w/${workspaceId}/projects/${project.id}/docs` : `/w/${workspaceId}/docs`, {
                replace: true,
              });
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
