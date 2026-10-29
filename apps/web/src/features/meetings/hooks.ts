import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMeetingInput, MeetingDto } from '@nexus/shared';
import { meetingsApi } from './api';
import { taskKeys } from '@/features/tasks/hooks';

export const meetingKeys = {
  all: ['meetings'] as const,
  lists: (workspaceId: string) => [...meetingKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, projectId?: string) =>
    [...meetingKeys.lists(workspaceId), projectId ?? 'all'] as const,
  detail: (id: string) => [...meetingKeys.all, 'detail', id] as const,
};

const isWorking = (m: Pick<MeetingDto, 'status'> | undefined) =>
  m?.status === 'PENDING' || m?.status === 'PROCESSING';
/** Poll while analysis runs in the background. */
const POLL_MS = 3000;

export function useMeetings(workspaceId: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: meetingKeys.list(workspaceId ?? '', projectId),
    queryFn: () => meetingsApi.list(workspaceId as string, { projectId }),
    enabled: Boolean(workspaceId),
    refetchInterval: (q) => (q.state.data?.items.some(isWorking) ? POLL_MS : false),
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: meetingKeys.detail(id ?? ''),
    queryFn: () => meetingsApi.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (q) => (isWorking(q.state.data) ? POLL_MS : false),
  });
}

export function useCreateMeeting(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeetingInput) => meetingsApi.create(workspaceId, input),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: meetingKeys.lists(workspaceId) }),
  });
}

export function useAnalyzeMeeting(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => meetingsApi.analyze(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

export function useConvertActionItems(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionItemIds: string[]; projectId: string }) =>
      meetingsApi.convert(id, input),
    onSuccess: (_tasks, vars) => {
      void queryClient.invalidateQueries({ queryKey: meetingKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(vars.projectId) });
    },
  });
}

export function useDeleteMeeting(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meetingsApi.delete(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: meetingKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: meetingKeys.lists(workspaceId) });
    },
  });
}
