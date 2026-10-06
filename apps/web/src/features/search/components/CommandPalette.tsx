import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowRight, Clock, CornerDownLeft, FileText, MessageSquare, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { SEARCH_TYPES } from '@nexus/shared';
import { useRecentSearches, useSearch } from '../hooks';
import { groupResults, resultHref, resultId, SEARCH_TYPE_LABELS, type SearchItem } from '../routes';
import { SearchResultItem } from './SearchResultItem';
import { useCreateDocument } from '@/features/documents/hooks';
import { useCurrentWorkspaceId, useWorkspaceProjects } from '@/features/workspaces/hooks';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { useCan } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface QuickAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Global search palette: Ctrl/Cmd+K anywhere, `/` when not typing. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl focus:outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          {open ? <PaletteBody onClose={() => setOpen(false)} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const workspaceId = useCurrentWorkspaceId();
  const { projectId } = useParams<{ projectId?: string }>();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const search = useSearch(workspaceId, q, SEARCH_TYPES, 5);
  const recent = useRecentSearches(workspaceId);
  const projects = useWorkspaceProjects(workspaceId ?? undefined);
  const createDoc = useCreateDocument(workspaceId ?? '');
  const canCreateDoc = useCan('document:create');
  const canCreateTask = useCan('task:create');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = useMemo(() => groupResults(search.data, SEARCH_TYPES), [search.data]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const trimmed = q.trim();

  const go = useCallback(
    (to: string) => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  const quickActions: QuickAction[] = useMemo(() => {
    if (!workspaceId) return [];
    const list: QuickAction[] = [];
    const targetProject = projectId ?? projects.data?.[0]?.id;
    if (canCreateTask && targetProject) {
      list.push({
        id: 'new-task',
        label: 'New task',
        hint: 'Open the board',
        icon: Plus,
        run: () => go(`/w/${workspaceId}/projects/${targetProject}/board`),
      });
    }
    if (canCreateDoc) {
      list.push({
        id: 'new-doc',
        label: 'New document',
        icon: FileText,
        run: () => {
          createDoc.mutate(
            { title: 'Untitled', projectId: projectId ?? null },
            {
              onSuccess: (doc) => go(`/w/${workspaceId}/docs/${doc.id}`),
              onError: (e) => toast.error(getErrorMessage(e)),
            },
          );
        },
      });
    }
    list.push({ id: 'chat', label: 'Go to Chat', icon: MessageSquare, run: () => go(`/w/${workspaceId}/chat`) });
    return list;
  }, [workspaceId, projectId, projects.data, canCreateTask, canCreateDoc, createDoc, go]);

  // Rows that keyboard navigation moves through.
  type Row = { kind: 'hit'; hit: SearchItem } | { kind: 'action'; action: QuickAction } | { kind: 'recent'; term: string } | { kind: 'more' };
  const rows: Row[] = useMemo(() => {
    if (!trimmed) {
      return [
        ...recent.recent.map((term): Row => ({ kind: 'recent', term })),
        ...quickActions.map((action): Row => ({ kind: 'action', action })),
      ];
    }
    const hits = flat.map((hit): Row => ({ kind: 'hit', hit }));
    return [...hits, { kind: 'more' }];
  }, [trimmed, recent.recent, quickActions, flat]);

  useEffect(() => setActive(0), [trimmed, rows.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const openSearchPage = () => {
    if (!workspaceId || !trimmed) return;
    recent.add(trimmed);
    go(`/w/${workspaceId}/search?q=${encodeURIComponent(trimmed)}`);
  };

  const run = (row: Row | undefined) => {
    if (!row) return;
    switch (row.kind) {
      case 'hit':
        if (!workspaceId) return;
        recent.add(trimmed);
        go(resultHref(workspaceId, row.hit));
        break;
      case 'action':
        row.action.run();
        break;
      case 'recent':
        setQ(row.term);
        break;
      case 'more':
        openSearchPage();
        break;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const activeId = rows[active] ? `palette-row-${active}` : undefined;
  let rowIndex = -1;
  const nextIndex = () => {
    rowIndex += 1;
    return rowIndex;
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={workspaceId ? 'Search tasks, docs, files, people…' : 'Pick a workspace to search'}
          aria-label="Search"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={!workspaceId}
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {search.isFetching || search.isDebouncing ? <Spinner label="Searching" /> : null}
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="size-3.5" />
          </button>
        ) : (
          <Kbd>Esc</Kbd>
        )}
      </div>

      <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
        {!trimmed ? (
          <>
            {recent.recent.length > 0 ? (
              <Group label="Recent" action={<button type="button" className="text-2xs text-muted-foreground hover:text-foreground" onClick={recent.clear}>Clear</button>}>
                {recent.recent.map((term) => {
                  const i = nextIndex();
                  return (
                    <PlainRow key={term} id={`palette-row-${i}`} active={active === i} onHover={() => setActive(i)} onSelect={() => setQ(term)} icon={Clock}>
                      <span className="flex-1 truncate">{term}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${term} from recent searches`}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          recent.remove(term);
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </PlainRow>
                  );
                })}
              </Group>
            ) : null}
            {quickActions.length > 0 ? (
              <Group label="Quick actions">
                {quickActions.map((a) => {
                  const i = nextIndex();
                  return (
                    <PlainRow key={a.id} id={`palette-row-${i}`} active={active === i} onHover={() => setActive(i)} onSelect={a.run} icon={a.icon}>
                      <span className="flex-1">{a.label}</span>
                      {a.hint ? <span className="text-xs text-muted-foreground">{a.hint}</span> : null}
                    </PlainRow>
                  );
                })}
              </Group>
            ) : null}
            {recent.recent.length === 0 && quickActions.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">Type to search this workspace.</p>
            ) : null}
          </>
        ) : search.isPending && !search.data ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground" aria-live="polite">
            Searching…
          </p>
        ) : search.isError ? (
          <p role="alert" className="px-2 py-6 text-center text-xs text-destructive">
            {search.error.message}
          </p>
        ) : (
          <>
            {groups.length === 0 && !search.isFetching ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground" aria-live="polite">
                No results for “{trimmed}”.
              </p>
            ) : null}
            {groups.map((g) => (
              <Group key={g.type} label={SEARCH_TYPE_LABELS[g.type]} count={search.data?.counts[g.type]}>
                {g.items.map((hit) => {
                  const i = nextIndex();
                  return (
                    <SearchResultItem
                      key={resultId(hit)}
                      id={`palette-row-${i}`}
                      hit={hit}
                      query={trimmed}
                      active={active === i}
                      onHover={() => setActive(i)}
                      onSelect={() => run({ kind: 'hit', hit })}
                    />
                  );
                })}
              </Group>
            ))}
            {(() => {
              const i = nextIndex();
              return (
                <PlainRow id={`palette-row-${i}`} active={active === i} onHover={() => setActive(i)} onSelect={openSearchPage} icon={ArrowRight} className="mt-1 border-t pt-2">
                  <span className="flex-1">
                    See all results for “{trimmed}”
                  </span>
                </PlainRow>
              );
            })()}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 border-t px-3 py-1.5 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>
            <CornerDownLeft className="size-2.5" aria-hidden />
          </Kbd>{' '}
          open
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd> toggle
        </span>
      </div>
    </div>
  );
}

function Group({ label, count, action, children }: { label: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="mb-1">
      <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
          {typeof count === 'number' && count > 0 ? <span className="ml-1.5 font-normal normal-case tracking-normal">{count}</span> : null}
        </h3>
        {action}
      </div>
      <ul className="space-y-px">{children}</ul>
    </div>
  );
}

function PlainRow({
  id,
  active,
  onHover,
  onSelect,
  icon: Icon,
  className,
  children,
}: {
  id: string;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  children: React.ReactNode;
}) {
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
        'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-[13px]',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {children}
    </li>
  );
}
