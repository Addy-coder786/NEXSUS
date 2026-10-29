import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AssistantChat } from '../components/AssistantChat';
import { AiSetupNotice } from '../components/AiSetupNotice';
import { useAiStatus, useConversations, useDeleteConversation } from '../hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/** `/w/:ws/assistant` and `/w/:ws/assistant/:conversationId`. */
export function AssistantPage() {
  const { workspaceId = '', conversationId } = useParams<{
    workspaceId: string;
    conversationId?: string;
  }>();
  const navigate = useNavigate();
  const status = useAiStatus();
  const conversations = useConversations(status.data?.enabled ? workspaceId : undefined);
  const remove = useDeleteConversation(workspaceId);
  const base = `/w/${workspaceId}/assistant`;

  if (status.isPending) return <Skeleton className="m-6 h-40" />;
  if (!status.data?.enabled) return <AiSetupNotice className="m-6" />;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r md:flex" aria-label="Conversations">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h1 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Assistant
          </h1>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            onClick={() => navigate(base)}
          >
            <MessageSquarePlus />
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {conversations.isPending ? (
            <div className="space-y-1.5 p-1.5">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : conversations.data?.items.length ? (
            <ul className="space-y-0.5">
              {conversations.data.items.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => navigate(`${base}/${c.id}`)}
                    aria-current={c.id === conversationId ? 'page' : undefined}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 pr-8 text-left text-[13px] hover:bg-accent',
                      c.id === conversationId && 'bg-accent font-medium',
                    )}
                  >
                    <span className="block truncate">{c.title}</span>
                    <span className="block text-2xs text-muted-foreground">
                      {formatRelative(c.lastMessageAt ?? c.createdAt)}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${c.title}`}
                    className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      remove.mutate(c.id, {
                        onSuccess: () =>
                          c.id === conversationId && navigate(base, { replace: true }),
                        onError: (e) => toast.error(getErrorMessage(e)),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">No conversations yet.</p>
          )}
        </nav>
      </aside>
      <section className="min-w-0 flex-1">
        <AssistantChat
          workspaceId={workspaceId}
          conversationId={conversationId}
          onConversationCreated={(id) => navigate(`${base}/${id}`, { replace: true })}
        />
      </section>
    </div>
  );
}
