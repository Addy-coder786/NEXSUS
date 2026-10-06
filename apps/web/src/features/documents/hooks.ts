import { useCallback, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDocumentInput, DocumentDto, DocumentSummaryDto, UpdateDocumentInput } from '@nexus/shared';
import { documentsApi, type DocumentFilters } from './api';
import { documentKeys } from './keys';
import { isApiError, type Paged } from '@/lib/api';

export { documentKeys };

type QC = ReturnType<typeof useQueryClient>;

export function useDocuments(workspaceId: string | null | undefined, filters: DocumentFilters = {}) {
  return useQuery({
    queryKey: documentKeys.list(workspaceId ?? '', filters),
    queryFn: () => documentsApi.list(workspaceId as string, filters),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useDocument(id: string | null | undefined) {
  return useQuery({
    queryKey: documentKeys.detail(id ?? ''),
    queryFn: () => documentsApi.get(id as string),
    enabled: Boolean(id),
  });
}

function toSummary(doc: DocumentDto): DocumentSummaryDto {
  const { content: _content, ...summary } = doc;
  return summary;
}

/** Patch the document in every cached list of its workspace (or drop it when `remove`). */
function syncLists(queryClient: QC, doc: DocumentDto, remove = false): void {
  queryClient.setQueriesData<Paged<DocumentSummaryDto>>({ queryKey: documentKeys.lists(doc.workspaceId) }, (old) => {
    if (!old) return old;
    if (remove) return { ...old, items: old.items.filter((d) => d.id !== doc.id) };
    const exists = old.items.some((d) => d.id === doc.id);
    return {
      ...old,
      items: exists ? old.items.map((d) => (d.id === doc.id ? toSummary(doc) : d)) : old.items,
    };
  });
}

export function useCreateDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) => documentsApi.create(workspaceId, input),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKeys.detail(doc.id), doc);
      void queryClient.invalidateQueries({ queryKey: documentKeys.lists(workspaceId) });
    },
  });
}

/**
 * Updates a document. A 409 (someone else saved a newer version) flips `conflict` to the
 * server's current version and refetches the document; callers show the reload banner.
 */
export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<{ currentVersion: number | null } | null>(null);
  const dismissConflict = useCallback(() => setConflict(null), []);

  const mutation = useMutation({
    mutationFn: (input: UpdateDocumentInput) => documentsApi.update(id, input),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKeys.detail(doc.id), doc);
      syncLists(queryClient, doc);
      void queryClient.invalidateQueries({ queryKey: documentKeys.versions(doc.id) });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        const details = error.details as { currentVersion?: number } | undefined;
        setConflict({ currentVersion: typeof details?.currentVersion === 'number' ? details.currentVersion : null });
        void queryClient.invalidateQueries({ queryKey: documentKeys.detail(id) });
      }
    },
  });

  return { ...mutation, conflict, dismissConflict };
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doc: Pick<DocumentDto, 'id' | 'workspaceId'>) => documentsApi.remove(doc.id),
    onSuccess: (_, doc) => {
      queryClient.setQueriesData<Paged<DocumentSummaryDto>>(
        { queryKey: documentKeys.lists(doc.workspaceId) },
        (old) => (old ? { ...old, items: old.items.filter((d) => d.id !== doc.id) } : old),
      );
      queryClient.removeQueries({ queryKey: documentKeys.detail(doc.id) });
      void queryClient.invalidateQueries({ queryKey: documentKeys.lists(doc.workspaceId) });
    },
  });
}

export function useDuplicateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.duplicate(id),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKeys.detail(doc.id), doc);
      void queryClient.invalidateQueries({ queryKey: documentKeys.lists(doc.workspaceId) });
    },
  });
}

export function useDocumentVersions(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: documentKeys.versions(id ?? ''),
    queryFn: () => documentsApi.versions(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useDocumentVersion(id: string | undefined, version: number | null) {
  return useQuery({
    queryKey: documentKeys.version(id ?? '', version ?? 0),
    queryFn: () => documentsApi.version(id as string, version as number),
    enabled: Boolean(id) && version !== null,
  });
}

export function useRestoreVersion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => documentsApi.restoreVersion(id, version),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKeys.detail(doc.id), doc);
      syncLists(queryClient, doc);
      void queryClient.invalidateQueries({ queryKey: documentKeys.versions(doc.id) });
    },
  });
}
