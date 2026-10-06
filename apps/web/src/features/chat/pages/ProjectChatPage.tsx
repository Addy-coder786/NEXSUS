import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { UserPublicDto } from '@nexus/shared';
import { Conversation } from '../components/Conversation';
import { ThreadPanel } from '../components/ThreadPanel';
import { useChannels } from '../hooks';
import { useProjectContext } from '@/features/projects/pages/ProjectLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Project tab: the project's own channel without the channel sidebar. */
export function ProjectChatPage() {
  const project = useProjectContext();
  const channels = useChannels(project.workspaceId);
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get('thread');
  const [members, setMembers] = useState<UserPublicDto[]>([]);

  const channel = useMemo(
    () => channels.data?.find((c) => c.projectId === project.id && !c.isArchived) ?? channels.data?.find((c) => c.projectId === project.id),
    [channels.data, project.id],
  );

  const setThread = useCallback(
    (messageId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (messageId) next.set('thread', messageId);
          else next.delete('thread');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (channels.isPending) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  if (channels.isError || !channel) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<MessageSquare />}
          title={channels.isError ? 'Could not load the project channel' : 'No channel for this project yet'}
          description={
            channels.isError
              ? channels.error.message
              : 'A channel is created automatically for new projects. If this project predates chat, ask an admin to create one.'
          }
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <Conversation
        key={channel.id}
        channel={channel}
        workspaceId={project.workspaceId}
        onOpenThread={(id) => setThread(id)}
        onMembers={setMembers}
        className={cn(threadId && 'hidden lg:flex')}
      />
      {threadId ? (
        <div className="flex min-w-0 flex-1 lg:w-[380px] lg:flex-none lg:border-l xl:w-[420px]">
          <ThreadPanel
            key={threadId}
            messageId={threadId}
            channel={channel}
            workspaceId={project.workspaceId}
            members={members}
            onClose={() => setThread(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
