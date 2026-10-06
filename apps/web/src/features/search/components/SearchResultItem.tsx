import { FileText, FolderKanban, Hash } from 'lucide-react';
import type { SearchItem } from '../routes';
import { highlight } from '../highlight';
import { FileIcon } from '@/features/files/components/FileIcon';
import { formatBytes } from '@/features/files/utils';
import { STATUS_LABELS } from '@/features/tasks/constants';
import { PriorityIcon } from '@/features/tasks/components/PriorityIcon';
import { STATUS_DOT } from '@/features/tasks/components/StatusBadge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SearchResultItemProps {
  hit: SearchItem;
  query: string;
  active?: boolean;
  /** Compact for the palette; roomy for the search page. */
  dense?: boolean;
  id?: string;
  onSelect: () => void;
  onHover?: () => void;
}

export function SearchResultItem({ hit, query, active = false, dense = true, id, onSelect, onHover }: SearchResultItemProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md px-2.5 text-[13px] outline-none',
        dense ? 'py-1.5' : 'py-2.5',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <ResultBody hit={hit} query={query} dense={dense} />
    </li>
  );
}

function ResultBody({ hit, query, dense }: { hit: SearchItem; query: string; dense: boolean }) {
  switch (hit.type) {
    case 'tasks': {
      const t = hit.item;
      return (
        <>
          <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[t.status])} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.key}</span>
              <span className="truncate font-medium">{highlight(t.title, query)}</span>
            </span>
            {!dense ? (
              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{STATUS_LABELS[t.status]}</span>
                <PriorityIcon priority={t.priority} withLabel />
                {t.assignee ? <span>· {t.assignee.name}</span> : null}
              </span>
            ) : null}
          </span>
          {dense && t.assignee ? <UserAvatar user={t.assignee} size="xs" /> : null}
        </>
      );
    }
    case 'projects': {
      const p = hit.item;
      return (
        <>
          <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{highlight(p.name, query)}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.key}</span>
            </span>
            {!dense && p.description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{highlight(p.description, query)}</span> : null}
          </span>
          <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </>
      );
    }
    case 'documents': {
      const d = hit.item;
      return (
        <>
          {d.icon ? (
            <span className="w-4 shrink-0 text-center text-sm leading-none" aria-hidden>
              {d.icon}
            </span>
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{highlight(d.title, query)}</span>
            {d.excerpt ? (
              <span className={cn('block truncate text-xs text-muted-foreground', dense && 'max-w-md')}>{highlight(d.excerpt, query)}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(d.updatedAt)}</span>
        </>
      );
    }
    case 'messages': {
      const m = hit.item;
      return (
        <>
          <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.author?.name ?? 'Slack'}</span>
              <span>in #{m.channelName}</span>
              <span>· {formatRelative(m.createdAt)}</span>
            </span>
            <span className={cn('block text-[13px]', dense ? 'truncate' : 'line-clamp-2')}>{highlight(m.snippet, query)}</span>
          </span>
        </>
      );
    }
    case 'files': {
      const f = hit.item;
      return (
        <>
          <FileIcon kind={f.kind} className="size-4" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{highlight(f.name, query)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {formatBytes(f.size)} · {f.uploadedBy.name} · {formatRelative(f.createdAt)}
            </span>
          </span>
        </>
      );
    }
    case 'users': {
      const u = hit.item;
      return (
        <>
          <UserAvatar user={u} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{highlight(u.name, query)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {highlight(u.email, query)}
              {u.title ? ` · ${u.title}` : ''}
            </span>
          </span>
        </>
      );
    }
  }
}
