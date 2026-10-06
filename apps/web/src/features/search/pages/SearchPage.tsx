import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { SEARCH_TYPES, type SearchType } from '@nexus/shared';
import { useRecentSearches, useSearch } from '../hooks';
import { groupResults, resultHref, resultId, SEARCH_TYPE_LABELS } from '../routes';
import { SearchResultItem } from '../components/SearchResultItem';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

const ALL = 'all';

function isSearchType(v: string | null): v is SearchType {
  return v !== null && (SEARCH_TYPES as readonly string[]).includes(v);
}

export function SearchPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const typeParam = params.get('type');
  const activeType: SearchType | typeof ALL = isSearchType(typeParam) ? typeParam : ALL;
  const [input, setInput] = useState(q);
  const recent = useRecentSearches(workspaceId);

  useEffect(() => setInput(q), [q]);

  // Counts always come from an all-types query; the filtered query fetches a deeper page for one type.
  const all = useSearch(workspaceId, q, SEARCH_TYPES, activeType === ALL ? 25 : 5);
  const one = useSearch(workspaceId, q, activeType === ALL ? [] : [activeType], 25);
  const results = activeType === ALL ? all : one;

  const groups = useMemo(
    () => groupResults(results.data, activeType === ALL ? SEARCH_TYPES : [activeType]),
    [results.data, activeType],
  );
  const counts = all.data?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (input.trim()) next.set('q', input.trim());
    else next.delete('q');
    setParams(next);
    if (input.trim()) recent.add(input.trim());
  };

  const setType = (t: SearchType | typeof ALL) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === ALL) next.delete('type');
        else next.set('type', t);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Search" description={q ? `Results for “${q}”` : 'Find anything in this workspace.'}>
        <form onSubmit={submit} className="relative max-w-xl" role="search">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search tasks, projects, documents, messages, files, people"
            aria-label="Search query"
            className="h-9 pl-9"
            autoFocus
          />
        </form>
        {q ? (
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Result type">
            <Chip label="All" count={total} active={activeType === ALL} onClick={() => setType(ALL)} />
            {SEARCH_TYPES.map((t) => (
              <Chip
                key={t}
                label={SEARCH_TYPE_LABELS[t]}
                count={counts?.[t]}
                active={activeType === t}
                onClick={() => setType(t)}
              />
            ))}
          </div>
        ) : null}
      </PageHeader>

      <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4', results.isFetching && results.data && 'opacity-80')}>
        {!q ? (
          recent.recent.length > 0 ? (
            <div className="max-w-xl">
              <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Recent searches</h2>
              <ul className="flex flex-wrap gap-1.5">
                {recent.recent.map((term) => (
                  <li key={term}>
                    <button
                      type="button"
                      className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setParams({ q: term })}
                    >
                      {term}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={<SearchIcon />} title="Search the workspace" description="Tip: press Ctrl+K (or /) anywhere to open the quick search." className="mx-auto max-w-xl" />
          )
        ) : results.isPending && !results.data ? (
          <div className="max-w-3xl space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : results.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {results.error.message}
          </p>
        ) : groups.length === 0 ? (
          <EmptyState icon={<SearchIcon />} title={`No results for “${q}”`} description="Check the spelling or try a broader term." className="mx-auto max-w-xl" />
        ) : (
          <div className="max-w-3xl space-y-6">
            {groups.map((g) => (
              <section key={g.type} aria-labelledby={`search-group-${g.type}`}>
                <div className="mb-1 flex items-baseline justify-between px-2.5">
                  <h2 id={`search-group-${g.type}`} className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {SEARCH_TYPE_LABELS[g.type]}
                    {counts?.[g.type] ? <span className="ml-1.5 font-normal normal-case tracking-normal">{counts[g.type]}</span> : null}
                  </h2>
                  {activeType === ALL && (counts?.[g.type] ?? 0) > g.items.length ? (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setType(g.type)}>
                      Show all
                    </button>
                  ) : null}
                </div>
                <ul role="listbox" aria-label={SEARCH_TYPE_LABELS[g.type]} className="divide-y rounded-lg border bg-card">
                  {g.items.map((hit) => (
                    <SearchResultItem
                      key={resultId(hit)}
                      hit={hit}
                      query={q}
                      dense={false}
                      onSelect={() => navigate(resultHref(workspaceId, hit))}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {label}
      {typeof count === 'number' ? <span className={cn('tabular-nums', active ? 'text-foreground' : 'text-muted-foreground')}>{count}</span> : null}
    </button>
  );
}
