import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, LayoutGrid, Rows3, Search } from 'lucide-react';
import type { DocumentListQuery, DocumentSummaryDto, ProjectDto } from '@nexus/shared';
import { useDocuments } from '../hooks';
import type { DocumentFilters } from '../api';
import { CreateDocumentButton } from './CreateDocumentButton';
import { DocumentCard, DocumentIcon, ProjectChip } from './DocumentCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';

type Sort = DocumentListQuery['sort'];
type View = 'list' | 'grid';

const ALL = '__all__';
const NONE = 'none';

interface DocumentListProps {
  workspaceId: string;
  /** Lock the list to one project (project Docs tab). */
  projectId?: string;
  className?: string;
}

export function DocumentList({ workspaceId, projectId, className }: DocumentListProps) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [sort, setSort] = useState<Sort>('updatedAt');
  const [archived, setArchived] = useState(false);
  const [project, setProject] = useState<string>(ALL);
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('nexus-docs-view') as View | null) ?? 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('nexus-docs-view', view);
    } catch {
      /* ignore */
    }
  }, [view]);

  const projects = useWorkspaceProjects(workspaceId);
  const projectById = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);

  const filters: DocumentFilters = useMemo(() => {
    const f: DocumentFilters = { sort, limit: 100 };
    if (debounced) f.search = debounced;
    if (archived) f.archived = true;
    if (projectId) f.projectId = projectId;
    else if (project !== ALL) f.projectId = project as DocumentFilters['projectId'];
    return f;
  }, [sort, debounced, archived, projectId, project]);

  const docs = useDocuments(workspaceId, filters);
  const items = (docs.data?.items ?? []).filter((d) => (archived ? true : !d.isArchived));

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents"
            aria-label="Search documents"
            className="h-7 w-56 pl-8 text-xs"
          />
        </div>
        {!projectId ? (
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger size="sm" className="w-40" aria-label="Filter by project">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              <SelectItem value={NONE}>Workspace only</SelectItem>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Sort documents">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">Last updated</SelectItem>
            <SelectItem value="createdAt">Date created</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={archived} onCheckedChange={(v) => setArchived(v === true)} aria-label="Show archived documents" />
          Show archived
        </label>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="View">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={cn(view === 'list' && 'bg-accent')}
            onClick={() => setView('list')}
          >
            <Rows3 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={cn(view === 'grid' && 'bg-accent')}
            onClick={() => setView('grid')}
          >
            <LayoutGrid />
          </Button>
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin', docs.isFetching && !docs.isPending && 'opacity-80')}>
        {docs.isPending ? (
          <div className="space-y-2 p-6" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : docs.isError ? (
          <p role="alert" className="p-6 text-[13px] text-destructive">
            {docs.error.message}
          </p>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileText />}
              title={debounced ? 'No documents match' : 'No documents yet'}
              description={
                debounced
                  ? 'Try a different search or clear the filters.'
                  : 'Write specs, meeting notes and plans. Documents autosave and keep a version history.'
              }
              action={!debounced ? <CreateDocumentButton workspaceId={workspaceId} projectId={projectId} /> : undefined}
            />
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((d) => (
              <DocumentCard
                key={d.id}
                doc={d}
                project={d.projectId ? projectById.get(d.projectId) : undefined}
                to={`/w/${workspaceId}/docs/${d.id}`}
              />
            ))}
          </div>
        ) : (
          <DocumentTable
            items={items}
            workspaceId={workspaceId}
            projectById={projectById}
            showProject={!projectId}
          />
        )}
      </div>
    </div>
  );
}

function DocumentTable({
  items,
  workspaceId,
  projectById,
  showProject,
}: {
  items: DocumentSummaryDto[];
  workspaceId: string;
  projectById: Map<string, ProjectDto>;
  showProject: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-6">Title</TableHead>
          {showProject ? <TableHead className="w-48">Project</TableHead> : null}
          <TableHead className="w-56">Updated</TableHead>
          <TableHead className="w-40 pr-6">Created by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="pl-6">
              <Link
                to={`/w/${workspaceId}/docs/${d.id}`}
                className="flex items-center gap-2 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DocumentIcon icon={d.icon} />
                <span className="truncate">{d.title}</span>
                {d.isArchived ? <Badge variant="secondary">Archived</Badge> : null}
              </Link>
              {d.excerpt ? <p className="ml-8 mt-0.5 truncate text-xs text-muted-foreground">{d.excerpt}</p> : null}
            </TableCell>
            {showProject ? (
              <TableCell>
                {d.projectId ? <ProjectChip project={projectById.get(d.projectId)} /> : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
            ) : null}
            <TableCell className="text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" title={formatDateTime(d.updatedAt)}>
                <UserAvatar user={d.updatedBy} size="xs" />
                <span className="truncate">{d.updatedBy.name}</span>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">{formatRelative(d.updatedAt)}</span>
              </span>
            </TableCell>
            <TableCell className="pr-6 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar user={d.createdBy} size="xs" />
                <span className="truncate">{d.createdBy.name}</span>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
