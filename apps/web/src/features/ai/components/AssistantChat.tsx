import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowUp, ListPlus, Sparkles, Square } from 'lucide-react';
import type { AiMessageDto, AiScope } from '@nexus/shared';
import { useAssistantChat, useCreateConversation } from '../hooks';
import { stripActionBlock } from '../stream';
import { GenerateTasksDialog } from './GenerateTasksDialog';
import { Markdown } from './Markdown';
import { SourceChips, ToolCallList } from './SourceChips';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'What is overdue right now?',
  'What did the team get done this week?',
  'Who has the most open work?',
  'Plan the tasks for a new onboarding flow',
];

interface AssistantChatProps {
  workspaceId: string;
  conversationId: string | undefined;
  /** Called when the first message creates a new conversation. */
  onConversationCreated?: (id: string) => void;
  /** Scope for a conversation created from this chat. */
  scope?: { scope: AiScope; scopeId: string | null };
  /** Called when the user follows a source link (e.g. to close a side panel). */
  onNavigate?: () => void;
  compact?: boolean;
}

export function AssistantChat({
  workspaceId,
  conversationId: propId,
  onConversationCreated,
  scope,
  onNavigate,
  compact = false,
}: AssistantChatProps) {
  // A conversation this chat created stays active even if the parent does not pass it back.
  const [createdId, setCreatedId] = useState<string | undefined>();
  useEffect(() => setCreatedId(undefined), [propId]);
  const conversationId = propId ?? createdId;
  const chat = useAssistantChat(conversationId, workspaceId);
  const create = useCreateConversation(workspaceId);
  const [draft, setDraft] = useState('');
  const [planText, setPlanText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const canGenerate = useCan('ai:generate');

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.messages.length, chat.streaming?.text]);

  const submit = async (value = draft) => {
    const content = value.trim();
    if (!content || chat.isStreaming || create.isPending) return;
    setDraft('');
    let id = conversationId;
    if (!id) {
      const conversation = await create.mutateAsync(
        scope?.scopeId ? { scope: scope.scope, scopeId: scope.scopeId } : {},
      );
      id = conversation.id;
      setCreatedId(id);
      onConversationCreated?.(id);
    }
    await chat.send(content, id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const empty = chat.messages.length === 0 && !chat.isStreaming;
  const planProjectId =
    chat.conversation?.scope === 'project'
      ? (chat.conversation.scopeId ?? undefined)
      : scope?.scope === 'project'
        ? (scope.scopeId ?? undefined)
        : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 py-3' : 'px-6 py-4')}
        aria-live="polite"
      >
        {empty ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Ask about your workspace</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                The assistant searches tasks, documents, chat and meeting notes you have access to.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => void submit(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('mx-auto space-y-4', !compact && 'max-w-3xl')}>
            {chat.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onNavigate={onNavigate}
                onPlan={canGenerate ? setPlanText : undefined}
              />
            ))}
            {chat.streaming ? (
              <div className="text-sm">
                <ToolCallList toolCalls={chat.streaming.toolCalls} live />
                {chat.streaming.text ? (
                  <Markdown>{stripActionBlock(chat.streaming.text)}</Markdown>
                ) : (
                  <p className="animate-pulse text-[13px] text-muted-foreground">Thinking…</p>
                )}
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
        {chat.error ? (
          <p
            role="alert"
            className={cn(
              'mx-auto mt-3 flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive',
              !compact && 'max-w-3xl',
            )}
          >
            <AlertTriangle className="size-4 shrink-0" /> {chat.error}
          </p>
        ) : null}
      </div>

      <div className={cn('border-t', compact ? 'p-2' : 'px-6 py-3')}>
        <div className={cn('relative mx-auto', !compact && 'max-w-3xl')}>
          <Textarea
            aria-label="Message the assistant"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={compact ? 2 : 3}
            maxLength={8000}
            placeholder="Ask anything about your projects, tasks and docs…"
            className="resize-none pr-12"
          />
          {chat.isStreaming ? (
            <Button
              size="icon-sm"
              variant="secondary"
              className="absolute bottom-2 right-2"
              onClick={chat.stop}
              aria-label="Stop"
            >
              <Square />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="absolute bottom-2 right-2"
              onClick={() => void submit()}
              disabled={!draft.trim() || create.isPending}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>

      {planText !== null ? (
        <GenerateTasksDialog
          open
          onOpenChange={(open) => !open && setPlanText(null)}
          workspaceId={workspaceId}
          projectId={planProjectId}
          initialText={planText ?? ''}
          source={
            conversationId ? { type: 'assistant', id: conversationId } : { type: 'assistant' }
          }
        />
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  onNavigate,
  onPlan,
}: {
  message: AiMessageDto;
  onNavigate?: () => void;
  onPlan?: (text: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <ToolCallList toolCalls={message.toolCalls} />
      {message.status === 'error' ? (
        <p className="flex items-center gap-1.5 text-[13px] text-destructive">
          <AlertTriangle className="size-4" /> {message.error ?? 'Something went wrong'}
        </p>
      ) : (
        <Markdown className={cn(message.status === 'refused' && 'text-muted-foreground')}>
          {message.content}
        </Markdown>
      )}
      <SourceChips sources={message.sources} onNavigate={onNavigate} />
      {message.suggestedAction?.type === 'generate_tasks' && onPlan ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => onPlan(message.suggestedAction?.text ?? message.content)}
        >
          <ListPlus /> Create these tasks
        </Button>
      ) : null}
    </div>
  );
}
