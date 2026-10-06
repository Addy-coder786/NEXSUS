import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronLeft, Copy, History, MoreHorizontal, Trash2 } from 'lucide-react';
import type { DocumentDto, ProjectDto } from '@nexus/shared';
import { DocumentIcon, ProjectChip } from './DocumentCard';
import { SaveIndicator } from './SaveIndicator';
import type { SaveStatus } from '../autosave';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Small curated emoji set; the schema allows up to 8 chars. */
export const DOCUMENT_ICONS = [
  '📄', '📝', '📋', '📌', '📊', '📈', '🗂️', '📁',
  '💡', '🎯', '🚀', '🧭', '🛠️', '🧪', '🔬', '🧩',
  '📣', '🤝', '🗓️', '✅', '⚠️', '🔒', '🌱', '🏁',
] as const;

interface DocumentHeaderProps {
  doc: DocumentDto;
  workspaceId: string;
  project?: Pick<ProjectDto, 'id' | 'name' | 'color'>;
  status: SaveStatus;
  readOnly: boolean;
  canDelete: boolean;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string | null) => void;
  onDuplicate: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onOpenHistory: () => void;
}

export function DocumentHeader({
  doc,
  workspaceId,
  project,
  status,
  readOnly,
  canDelete,
  onTitleChange,
  onIconChange,
  onDuplicate,
  onToggleArchive,
  onDelete,
  onOpenHistory,
}: DocumentHeaderProps) {
  const backTo = project ? `/w/${workspaceId}/projects/${project.id}/docs` : `/w/${workspaceId}/docs`;
  return (
    <header className="flex flex-col gap-3 border-b px-6 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to={backTo}>
            <ChevronLeft /> {project ? `${project.name} docs` : 'Documents'}
          </Link>
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <SaveIndicator status={status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Document actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onOpenHistory}>
                <History /> Version history
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              {!readOnly ? (
                <DropdownMenuItem onSelect={onToggleArchive}>
                  {doc.isArchived ? (
                    <>
                      <ArchiveRestore /> Restore from archive
                    </>
                  ) : (
                    <>
                      <Archive /> Archive
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={onDelete}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div className="flex items-start gap-2">
        <IconPicker icon={doc.icon} disabled={readOnly} onChange={onIconChange} />
        <TitleInput title={doc.title} disabled={readOnly} onChange={onTitleChange} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {project ? (
          <Link to={`/w/${workspaceId}/projects/${project.id}/docs`} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ProjectChip project={project} />
          </Link>
        ) : (
          <span className="rounded-md border px-1.5 py-0.5 text-2xs">Workspace document</span>
        )}
        {doc.isArchived ? <span className="rounded-md bg-secondary px-1.5 py-0.5 text-2xs">Archived</span> : null}
        <span>v{doc.version}</span>
        <span aria-hidden>·</span>
        <span>Edited by {doc.updatedBy.name}</span>
      </div>
    </header>
  );
}

function IconPicker({
  icon,
  disabled,
  onChange,
}: {
  icon: string | null;
  disabled: boolean;
  onChange: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return <DocumentIcon icon={icon} className="mt-1.5 size-8 text-2xl" />;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SimpleTooltip label="Change icon">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Change document icon"
            className="mt-1 flex size-9 items-center justify-center rounded-md text-2xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <DocumentIcon icon={icon} className="size-8 text-2xl" />
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="Document icon">
          {DOCUMENT_ICONS.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={icon === e}
              aria-label={e}
              className={cn(
                'flex size-7 items-center justify-center rounded text-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                icon === e && 'bg-accent ring-1 ring-ring',
              )}
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-muted-foreground"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          Remove icon
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function TitleInput({ title, disabled, onChange }: { title: string; disabled: boolean; onChange: (t: string) => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(title), [title]);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resize, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      disabled={disabled}
      aria-label="Document title"
      placeholder="Untitled"
      maxLength={200}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, '');
        setValue(next);
        if (next.trim()) onChange(next.trim());
      }}
      onBlur={() => {
        if (!value.trim()) {
          setValue(title);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Move focus into the body.
          const body = document.querySelector<HTMLElement>('.prose-nexus .tiptap');
          body?.focus();
        }
      }}
      className="min-h-0 w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-1 text-2xl font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 disabled:cursor-default"
    />
  );
}
