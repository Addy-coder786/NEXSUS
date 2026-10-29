import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  ChevronRight,
  File,
  FileText,
  FolderKanban,
  MessageSquare,
  Search,
  SquareCheck,
} from 'lucide-react';
import type { AiSourceDto, AiToolCallDto } from '@nexus/shared';
import { cn } from '@/lib/utils';

const ICONS: Record<AiSourceDto['type'], React.ComponentType<{ className?: string }>> = {
  task: SquareCheck,
  project: FolderKanban,
  document: FileText,
  message: MessageSquare,
  file: File,
  meeting: CalendarClock,
};

export function SourceChips({
  sources,
  onNavigate,
}: {
  sources: AiSourceDto[];
  onNavigate?: () => void;
}) {
  if (!sources.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((s) => {
        const Icon = ICONS[s.type];
        return (
          <li key={`${s.type}:${s.id}`}>
            <Link
              to={s.link}
              onClick={onNavigate}
              title={s.snippet ?? s.title}
              className="inline-flex max-w-[240px] items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon className="size-3 shrink-0" />
              <span className="truncate">{s.title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Collapsible "Looked at N things" row listing the tools the assistant used. */
export function ToolCallList({
  toolCalls,
  live = false,
}: {
  toolCalls: AiToolCallDto[];
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!toolCalls.length) return null;
  const last = toolCalls[toolCalls.length - 1];
  return (
    <div className="mb-1.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Search className="size-3" />
        {live && last
          ? `${last.label}…`
          : `Looked at ${toolCalls.length} ${toolCalls.length === 1 ? 'source' : 'sources'}`}
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 pl-5">
          {toolCalls.map((t, i) => (
            <li key={i}>
              {t.label}
              {t.resultCount !== null ? (
                <span className="opacity-70"> · {t.resultCount} found</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
