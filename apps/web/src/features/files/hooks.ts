import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileDto, StorageUsageDto } from '@nexus/shared';
import { filesApi, type FileFilters, type UploadArgs } from './api';
import { fileKeys } from './keys';
import type { Paged } from '@/lib/api';

export { fileKeys };

type QC = ReturnType<typeof useQueryClient>;

export function useFiles(workspaceId: string | null | undefined, filters: FileFilters = {}) {
  return useQuery({
    queryKey: fileKeys.list(workspaceId ?? '', filters),
    queryFn: () => filesApi.list(workspaceId as string, filters),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useFile(id: string | null | undefined) {
  return useQuery({
    queryKey: fileKeys.detail(id ?? ''),
    queryFn: () => filesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useTaskFiles(taskId: string | null | undefined) {
  return useQuery({
    queryKey: fileKeys.task(taskId ?? ''),
    queryFn: () => filesApi.taskFiles(taskId as string),
    enabled: Boolean(taskId),
  });
}

export function useStorageUsage(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: fileKeys.usage(workspaceId ?? ''),
    queryFn: () => filesApi.usage(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

function afterFileChange(queryClient: QC, file: Pick<FileDto, 'workspaceId' | 'taskId'>): void {
  void queryClient.invalidateQueries({ queryKey: fileKeys.lists(file.workspaceId) });
  void queryClient.invalidateQueries({ queryKey: fileKeys.usage(file.workspaceId) });
  if (file.taskId) void queryClient.invalidateQueries({ queryKey: fileKeys.task(file.taskId) });
}

/** Uploads one file with progress; callers run several in sequence for multi-file drops. */
export function useUploadFile(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: UploadArgs) => filesApi.upload(workspaceId, args),
    onSuccess: (file) => {
      queryClient.setQueryData(fileKeys.detail(file.id), file);
      if (file.taskId) {
        queryClient.setQueryData<FileDto[]>(fileKeys.task(file.taskId), (old) => (old ? [file, ...old] : old));
      }
      queryClient.setQueryData<StorageUsageDto>(fileKeys.usage(file.workspaceId), (old) =>
        old ? { ...old, usedBytes: old.usedBytes + file.size, fileCount: old.fileCount + 1 } : old,
      );
      afterFileChange(queryClient, file);
    },
  });
}

export function useRenameFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => filesApi.rename(id, name),
    onSuccess: (file) => {
      queryClient.setQueryData(fileKeys.detail(file.id), file);
      queryClient.setQueriesData<Paged<FileDto>>({ queryKey: fileKeys.lists(file.workspaceId) }, (old) =>
        old ? { ...old, items: old.items.map((f) => (f.id === file.id ? file : f)) } : old,
      );
      if (file.taskId) {
        queryClient.setQueryData<FileDto[]>(fileKeys.task(file.taskId), (old) =>
          old ? old.map((f) => (f.id === file.id ? file : f)) : old,
        );
      }
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: Pick<FileDto, 'id' | 'workspaceId' | 'taskId' | 'size'>) => filesApi.remove(file.id),
    onSuccess: (_, file) => {
      queryClient.setQueriesData<Paged<FileDto>>({ queryKey: fileKeys.lists(file.workspaceId) }, (old) =>
        old
          ? { ...old, items: old.items.filter((f) => f.id !== file.id), meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } }
          : old,
      );
      if (file.taskId) {
        queryClient.setQueryData<FileDto[]>(fileKeys.task(file.taskId), (old) =>
          old ? old.filter((f) => f.id !== file.id) : old,
        );
      }
      queryClient.setQueryData<StorageUsageDto>(fileKeys.usage(file.workspaceId), (old) =>
        old
          ? { ...old, usedBytes: Math.max(0, old.usedBytes - file.size), fileCount: Math.max(0, old.fileCount - 1) }
          : old,
      );
      queryClient.removeQueries({ queryKey: fileKeys.detail(file.id) });
      afterFileChange(queryClient, file);
    },
  });
}
