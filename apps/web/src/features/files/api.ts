import type { FileDto, FileListQuery, StorageUsageDto, UploadFileFields } from '@nexus/shared';
import { api, cleanParams, request, type Paged } from '@/lib/api';

export type FileFilters = Partial<
  Pick<FileListQuery, 'projectId' | 'taskId' | 'channelId' | 'kind' | 'search' | 'sort' | 'order' | 'page' | 'limit'>
>;

export interface UploadArgs {
  file: File;
  fields?: UploadFileFields;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const filesApi = {
  list: (workspaceId: string, filters: FileFilters = {}): Promise<Paged<FileDto>> =>
    api.getPaged<FileDto>(`/workspaces/${workspaceId}/files`, cleanParams({ ...filters })),
  upload: (workspaceId: string, { file, fields, onProgress, signal }: UploadArgs) => {
    const form = new FormData();
    form.append('file', file, file.name);
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v) form.append(k, v);
    }
    return request<FileDto>({
      method: 'POST',
      url: `/workspaces/${workspaceId}/files`,
      data: form,
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
      signal,
      onUploadProgress: (evt) => {
        if (!onProgress) return;
        const total = evt.total ?? file.size;
        onProgress(total > 0 ? Math.min(1, evt.loaded / total) : 0);
      },
    });
  },
  usage: (workspaceId: string) => api.get<StorageUsageDto>(`/workspaces/${workspaceId}/files/usage`),
  get: (id: string) => api.get<FileDto>(`/files/${id}`),
  rename: (id: string, name: string) => api.patch<FileDto>(`/files/${id}`, { name }),
  remove: (id: string) => api.delete(`/files/${id}`),
  taskFiles: (taskId: string) => api.get<FileDto[]>(`/tasks/${taskId}/files`),
};
