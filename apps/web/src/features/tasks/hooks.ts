import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CommentDto, CreateCommentInput, MoveTaskInput, PaginationQuery, TaskDto } from '@nexus/shared';
import { tasksApi, type CreateTaskBody, type TaskFilters, type UpdateTaskBody } from './api';
import { projectKeys } from '@/features/projects/keys';
import { getErrorMessage, type Paged } from '@/lib/api';

export const taskKeys = {
  all: ['tasks'] as const,
  lists: (projectId: string) => [...taskKeys.all, 'list', projectId] as const,
  list: (projectId: string, filters: TaskFilters) => [...taskKeys.lists(projectId), filters] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
  subtasks: (id: string) => [...taskKeys.all, 'subtasks', id] as const,
  comments: (id: string) => [...taskKeys.all, 'comments', id] as const,
};

export function useTasks(projectId: string | undefined, filters: TaskFilters = {}) {
  return useQuery({
    queryKey: taskKeys.list(projectId ?? '', filters),
    queryFn: () => tasksApi.list(projectId as string, filters),
    enabled: Boolean(projectId),
    placeholderData: (prev) => prev,
  });
}

export function useTask(id: string | null | undefined) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ''),
    queryFn: () => tasksApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useSubtasks(id: string | undefined) {
  return useQuery({
    queryKey: taskKeys.subtasks(id ?? ''),
    queryFn: () => tasksApi.subtasks(id as string),
    enabled: Boolean(id),
  });
}

type QC = ReturnType<typeof useQueryClient>;

/** Patch a task inside every cached list for the project. */
function patchTaskInLists(queryClient: QC, projectId: string, id: string, patch: Partial<TaskDto>): void {
  queryClient.setQueriesData<Paged<TaskDto>>({ queryKey: taskKeys.lists(projectId) }, (old) => {
    if (!old) return old;
    return { ...old, items: old.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
  });
}

function invalidateTaskRelated(queryClient: QC, task: Pick<TaskDto, 'projectId' | 'parentTaskId'>): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.lists(task.projectId) });
  void queryClient.invalidateQueries({ queryKey: projectKeys.detail(task.projectId) });
  void queryClient.invalidateQueries({ queryKey: [...projectKeys.all, 'activities', task.projectId] });
  if (task.parentTaskId) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.parentTaskId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.parentTaskId) });
  }
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskBody) => tasksApi.create(projectId, input),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      invalidateTaskRelated(queryClient, task);
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskBody & { id: string }) => tasksApi.update(id, input),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      patchTaskInLists(queryClient, task.projectId, task.id, task);
      invalidateTaskRelated(queryClient, task);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

interface MoveVars extends MoveTaskInput {
  id: string;
}

interface MoveContext {
  snapshots: [readonly unknown[], Paged<TaskDto> | undefined][];
  detail: TaskDto | undefined;
}

/** Optimistic move: updates status + position in every cached list immediately, rolls back on error. */
export function useMoveTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<TaskDto, Error, MoveVars, MoveContext>({
    mutationFn: ({ id, ...input }) => tasksApi.move(id, input),
    onMutate: async ({ id, status, position }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists(projectId) });
      const snapshots = queryClient.getQueriesData<Paged<TaskDto>>({ queryKey: taskKeys.lists(projectId) });
      const detail = queryClient.getQueryData<TaskDto>(taskKeys.detail(id));
      const now = new Date().toISOString();
      const patch: Partial<TaskDto> = { status, updatedAt: now };
      if (position !== undefined) patch.position = position;
      if (status === 'DONE') patch.completedAt = now;
      else patch.completedAt = null;
      patchTaskInLists(queryClient, projectId, id, patch);
      if (detail) queryClient.setQueryData<TaskDto>(taskKeys.detail(id), { ...detail, ...patch });
      return { snapshots, detail };
    },
    onError: (error, vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
      if (context?.detail) queryClient.setQueryData(taskKeys.detail(vars.id), context.detail);
      toast.error(getErrorMessage(error, 'Could not move task'));
    },
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      patchTaskInLists(queryClient, projectId, task.id, task);
    },
    onSettled: (task) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      if (task?.parentTaskId) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.parentTaskId) });
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: Pick<TaskDto, 'id' | 'projectId' | 'parentTaskId'>) => tasksApi.remove(task.id),
    onSuccess: (_, task) => {
      queryClient.setQueriesData<Paged<TaskDto>>({ queryKey: taskKeys.lists(task.projectId) }, (old) =>
        old ? { ...old, items: old.items.filter((t) => t.id !== task.id) } : old,
      );
      queryClient.removeQueries({ queryKey: taskKeys.detail(task.id) });
      invalidateTaskRelated(queryClient, task);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useComments(taskId: string | undefined, query?: Partial<PaginationQuery>) {
  return useQuery({
    queryKey: [...taskKeys.comments(taskId ?? ''), query ?? {}],
    queryFn: () => tasksApi.comments(taskId as string, { limit: 100, ...query }),
    enabled: Boolean(taskId),
  });
}

export function useAddComment(taskId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => tasksApi.addComment(taskId, input),
    onSuccess: (comment) => {
      queryClient.setQueriesData<Paged<CommentDto>>({ queryKey: taskKeys.comments(taskId) }, (old) =>
        old ? { ...old, items: [...old.items, comment], meta: { ...old.meta, total: old.meta.total + 1 } } : old,
      );
      queryClient.setQueryData<TaskDto>(taskKeys.detail(taskId), (old) =>
        old ? { ...old, commentCount: old.commentCount + 1 } : old,
      );
      patchTaskInLists(queryClient, projectId, taskId, {});
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useUpdateComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) => tasksApi.updateComment(commentId, body),
    onSuccess: (comment) => {
      queryClient.setQueriesData<Paged<CommentDto>>({ queryKey: taskKeys.comments(taskId) }, (old) =>
        old ? { ...old, items: old.items.map((c) => (c.id === comment.id ? comment : c)) } : old,
      );
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteComment(taskId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => tasksApi.removeComment(commentId),
    onSuccess: (_, commentId) => {
      queryClient.setQueriesData<Paged<CommentDto>>({ queryKey: taskKeys.comments(taskId) }, (old) =>
        old
          ? { ...old, items: old.items.filter((c) => c.id !== commentId), meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } }
          : old,
      );
      queryClient.setQueryData<TaskDto>(taskKeys.detail(taskId), (old) =>
        old ? { ...old, commentCount: Math.max(0, old.commentCount - 1) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
