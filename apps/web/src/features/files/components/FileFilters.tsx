import { LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { FILE_KINDS, type FileKind, type ProjectDto } from '@nexus/shared';
import { KIND_LABELS } from '../utils';
import type { FileView } from './FileGrid';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ALL = '__all__';

export interface FileFilterState {
  search: string;
  kind: FileKind | '';
  projectId: string;
  sort: 'createdAt' | 'name' | 'size';
}

interface FileFiltersProps {
  value: FileFilterState;
  onChange: (next: FileFilterState) => void;
  projects?: ProjectDto[];
  view: FileView;
  onViewChange: (view: FileView) => void;
  trailing?: React.ReactNode;
}

export function FileFilters({ value, onChange, projects, view, onViewChange, trailing }: FileFiltersProps) {
  const set = <K extends keyof FileFilterState>(key: K, v: FileFilterState[K]) => onChange({ ...value, [key]: v });
  const active = Boolean(value.search || value.kind || value.projectId);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={value.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search files"
          aria-label="Search files"
          className="h-7 w-52 pl-8 text-xs"
        />
      </div>
      <Select value={value.kind || ALL} onValueChange={(v) => set('kind', v === ALL ? '' : (v as FileKind))}>
        <SelectTrigger size="sm" className="w-32" aria-label="Filter by type">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {FILE_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {KIND_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {projects ? (
        <Select value={value.projectId || ALL} onValueChange={(v) => set('projectId', v === ALL ? '' : v)}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => (
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
      <Select value={value.sort} onValueChange={(v) => set('sort', v as FileFilterState['sort'])}>
        <SelectTrigger size="sm" className="w-32" aria-label="Sort files">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="createdAt">Newest</SelectItem>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="size">Size</SelectItem>
        </SelectContent>
      </Select>
      {active ? (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange({ ...value, search: '', kind: '', projectId: '' })}>
          <X /> Clear
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="View">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={cn(view === 'grid' && 'bg-accent')}
            onClick={() => onViewChange('grid')}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={cn(view === 'list' && 'bg-accent')}
            onClick={() => onViewChange('list')}
          >
            <Rows3 />
          </Button>
        </div>
        {trailing}
      </div>
    </div>
  );
}
