import { useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AiConversationDto } from '@nexus/shared';
import { MessageSquarePlus, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AssistantChat } from '../components/AssistantChat';
import { AiSetupNotice } from '../components/AiSetupNotice';
import {
  useAiStatus,
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const rename = useRenameConversation();
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
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  active={c.id === conversationId}
                  onOpen={() => navigate(`${base}/${c.id}`)}
                  onRename={(title) =>
                    rename.mutate(
                      { id: c.id, title },
                      { onError: (e) => toast.error(getErrorMessage(e)) },
                    )
                  }
                  onDelete={() =>
                    remove.mutate(c.id, {
                      onSuccess: () => c.id === conversationId && navigate(base, { replace: true }),
                      onError: (e) => toast.error(getErrorMessage(e)),
                    })
                  }
                />
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

interface ConversationItemProps {
  conversation: AiConversationDto;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

/** One sidebar row: open on click; rename inline (Enter saves, Escape cancels); delete. */
function ConversationItem({
  conversation: c,
  active,
  onOpen,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);

  const save = () => {
    const next = title.trim();
    setEditing(false);
    if (next && next !== c.title) onRename(next);
    else setTitle(c.title);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      setTitle(c.title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="px-1 py-1">
        <Input
          autoFocus
          aria-label="Conversation title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
          className="h-7 text-[13px]"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'w-full rounded-md px-2 py-1.5 pr-14 text-left text-[13px] hover:bg-accent',
          active && 'bg-accent font-medium',
        )}
      >
        <span className="block truncate">{c.title}</span>
        <span className="block text-2xs text-muted-foreground">
          {formatRelative(c.lastMessageAt ?? c.createdAt)}
        </span>
      </button>
      <div className="absolute right-1 top-1.5 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename ${c.title}`}
          onClick={() => {
            setTitle(c.title);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${c.title}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
