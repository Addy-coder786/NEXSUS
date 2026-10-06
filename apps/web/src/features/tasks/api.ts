import type {
  CommentDto,
  CreateCommentInput,
  CreateTaskInput,
  MoveTaskInput,
  PaginationQuery,
  TaskDto,
  TaskListQuery,
  UpdateTaskInput,
} from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

/** Wire format: dates travel as ISO strings (the API coerces them). */
export type CreateTaskBody = Omit<CreateTaskInput, 'dueDate' | 'startDate' | 'status' | 'priority'> & {
  status?: CreateTaskInput['status'];
  priority?: CreateTaskInput['priority'];
  dueDate?: string | null;
  startDate?: string | null;
};
export type UpdateTaskBody = Omit<UpdateTaskInput, 'dueDate' | 'startDate'> & {
  dueDate?: string | null;
  startDate?: string | null;
};

/** Filters the UI sends; all optional, everything else defaults server-side. */
export type TaskFilters = Partial<
  Pick<TaskListQuery, 'status' | 'priority' | 'assigneeId' | 'labelId' | 'search' | 'parentTaskId' | 'sort' | 'order' | 'page' | 'limit' | 'overdue'>
>;

export const tasksApi = {
  list: (projectId: string, filters: TaskFilters = {}): Promise<Paged<TaskDto>> =>
    api.getPaged<TaskDto>(`/projects/${projectId}/tasks`, cleanParams({ ...filters })),
  create: (projectId: string, input: CreateTaskBody) => api.post<TaskDto>(`/projects/${projectId}/tasks`, input),
  get: (id: string) => api.get<TaskDto>(`/tasks/${id}`),
  update: (id: string, input: UpdateTaskBody) => api.patch<TaskDto>(`/tasks/${id}`, input),
  move: (id: string, input: MoveTaskInput) => api.patch<TaskDto>(`/tasks/${id}/move`, input),
  remove: (id: string) => api.delete(`/tasks/${id}`),
  subtasks: (id: string) => api.get<TaskDto[]>(`/tasks/${id}/subtasks`),

  comments: (taskId: string, query?: Partial<PaginationQuery>): Promise<Paged<CommentDto>> =>
    api.getPaged<CommentDto>(`/tasks/${taskId}/comments`, cleanParams({ ...query })),
  addComment: (taskId: string, input: CreateCommentInput) =>
    api.post<CommentDto>(`/tasks/${taskId}/comments`, input),
  updateComment: (commentId: string, body: string) => api.patch<CommentDto>(`/comments/${commentId}`, { body }),
  removeComment: (commentId: string) => api.delete(`/comments/${commentId}`),
};
