import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { ChatLayout } from '../components/ChatLayout';
import { useChannels } from '../hooks';
import { pickDefaultChannel } from '../utils';
import { EmptyState } from '@/components/ui/empty-state';
import { isApiError } from '@/lib/api';

/** `/w/:workspaceId/chat` and `/w/:workspaceId/chat/:channelId` — the route param drives the selection. */
export function ChatPage() {
  const { workspaceId = '', channelId } = useParams<{ workspaceId: string; channelId?: string }>();
  const navigate = useNavigate();
  const channels = useChannels(workspaceId);

  const channel = useMemo(() => channels.data?.find((c) => c.id === channelId), [channels.data, channelId]);

  // No channel selected: open the first project channel, then #general.
  useEffect(() => {
    if (channelId || !channels.data) return;
    const target = pickDefaultChannel(channels.data);
    if (target) navigate(`/w/${workspaceId}/chat/${target.id}`, { replace: true });
  }, [channelId, channels.data, navigate, workspaceId]);

  if (channels.isError) {
    const forbidden = isApiError(channels.error) && channels.error.status === 403;
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<MessageSquare />}
          title={forbidden ? 'Chat is not available' : 'Could not load channels'}
          description={channels.error.message}
        />
      </div>
    );
  }

  if (channelId && channels.data && !channel) {
    return (
      <div className="flex h-full min-h-0">
        <ChatLayout workspaceId={workspaceId} channels={channels.data} channelsLoading={false} channel={undefined} />
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<MessageSquare />}
            title="Channel not found"
            description="This channel does not exist or you do not have access to it."
          />
        </div>
      </div>
    );
  }

  return (
    <ChatLayout workspaceId={workspaceId} channels={channels.data} channelsLoading={channels.isPending} channel={channel} />
  );
}
