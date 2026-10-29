import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Maximize2, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import type { AiScope } from '@nexus/shared';
import { useAiEnabled } from '../hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// The chat (and its Markdown renderer) loads when the panel is first opened.
const AssistantChat = lazy(() =>
  import('./AssistantChat').then((m) => ({ default: m.AssistantChat })),
);
import { useCurrentWorkspaceId } from '@/features/workspaces/hooks';

/** Scope of a new side-panel conversation from the current route: document > project > workspace. */
function useRouteScope(): { scope: AiScope; scopeId: string | null; label: string } {
  const project = useMatch('/w/:workspaceId/projects/:projectId/*');
  const doc = useMatch('/w/:workspaceId/docs/:documentId');
  if (doc?.params.documentId)
    return { scope: 'document', scopeId: doc.params.documentId, label: 'this document' };
  if (project?.params.projectId)
    return { scope: 'project', scopeId: project.params.projectId, label: 'this project' };
  return { scope: 'workspace', scopeId: null, label: 'the workspace' };
}

/**
 * Floating "Ask AI" button with a side panel. The panel keeps its conversation while open and
 * starts a fresh one, scoped to the current page, after "New".
 */
export function AssistantLauncher() {
  const workspaceId = useCurrentWorkspaceId();
  const enabled = useAiEnabled();
  const onAssistantPage = useMatch('/w/:workspaceId/assistant/*');
  // Chat screens keep their composer in the bottom-right corner, where the button would sit.
  const onChat = useMatch('/w/:workspaceId/chat/*');
  const onProjectChat = useMatch('/w/:workspaceId/projects/:projectId/chat');
  const scope = useRouteScope();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();

  // A different workspace means a different conversation.
  useEffect(() => setConversationId(undefined), [workspaceId]);

  if (!workspaceId || !enabled || onAssistantPage || onChat || onProjectChat) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <DialogPrimitive.Trigger asChild>
        <Button
          className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg"
          size="lg"
          aria-label="Ask AI"
        >
          <Sparkles /> Ask AI
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <DialogPrimitive.Title className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> Assistant
              {!conversationId ? (
                <span className="font-normal text-muted-foreground">· about {scope.label}</span>
              ) : null}
            </DialogPrimitive.Title>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New conversation"
                onClick={() => setConversationId(undefined)}
              >
                <MessageSquarePlus />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Open full assistant" asChild>
                <Link
                  to={`/w/${workspaceId}/assistant${conversationId ? `/${conversationId}` : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <Maximize2 />
                </Link>
              </Button>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<Skeleton className="m-3 h-24" />}>
              <AssistantChat
                compact
                workspaceId={workspaceId}
                conversationId={conversationId}
                scope={scope}
                onConversationCreated={setConversationId}
              />
            </Suspense>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
