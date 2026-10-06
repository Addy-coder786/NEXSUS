import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { CommentDto } from '@nexus/shared';
import { useAddComment, useComments, useDeleteComment, useUpdateComment } from '../hooks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useAuthStore } from '@/stores/auth.store';
import { formatDateTime, formatRelative } from '@/lib/format';

interface TaskCommentsProps {
  taskId: string;
  projectId: string;
  canComment: boolean;
  canModerate: boolean;
}

export function TaskComments({ taskId, projectId, canComment, canModerate }: TaskCommentsProps) {
  const me = useAuthStore((s) => s.user);
  const comments = useComments(taskId);
  const add = useAddComment(taskId, projectId);
  const update = useUpdateComment(taskId);
  const remove = useDeleteComment(taskId, projectId);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    add.mutate({ body }, { onSuccess: () => setDraft('') });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comments{comments.data ? ` (${comments.data.meta.total})` : ''}
      </h3>
      {comments.isPending ? (
        <ul className="space-y-3" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="flex gap-2">
              <Skeleton className="size-6 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : comments.isError ? (
        <p role="alert" className="text-xs text-destructive">{comments.error.message}</p>
      ) : comments.data.items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.data.items.map((c: CommentDto) => {
            const mine = c.author.id === me?.id;
            const isEditing = editing?.id === c.id;
            return (
              <li key={c.id} className="group flex gap-2">
                <UserAvatar user={c.author} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground">{c.author.name}</span>
                    <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)} className="text-muted-foreground">
                      {formatRelative(c.createdAt)}
                    </time>
                    {c.editedAt ? <span className="text-muted-foreground">(edited)</span> : null}
                    {(mine || canModerate) && !isEditing ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                            aria-label="Comment actions"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {mine ? (
                            <DropdownMenuItem onSelect={() => setEditing({ id: c.id, body: c.body })}>Edit</DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem destructive onSelect={() => remove.mutate(c.id)}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  {isEditing ? (
                    <div className="mt-1 space-y-2">
                      <Textarea
                        value={editing.body}
                        onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                        rows={3}
                        aria-label="Edit comment"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        <Button
                          size="sm"
                          loading={update.isPending}
                          disabled={!editing.body.trim()}
                          onClick={() =>
                            update.mutate({ commentId: c.id, body: editing.body.trim() }, { onSuccess: () => setEditing(null) })
                          }
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{c.body}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canComment ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <UserAvatar user={me} size="sm" className="mt-1" />
          <div className="flex-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Write a comment… (Ctrl+Enter to send)"
              aria-label="New comment"
              rows={2}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={add.isPending} disabled={!draft.trim()}>
                Comment
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
