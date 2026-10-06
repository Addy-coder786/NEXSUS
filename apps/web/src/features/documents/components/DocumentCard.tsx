import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import type { DocumentSummaryDto, ProjectDto } from '@nexus/shared';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DocumentIcon({ icon, className }: { icon: string | null; className?: string }) {
  return icon ? (
    <span className={cn('inline-flex size-6 items-center justify-center text-base leading-none', className)} aria-hidden>
      {icon}
    </span>
  ) : (
    <span className={cn('inline-flex size-6 items-center justify-center text-muted-foreground', className)} aria-hidden>
      <FileText className="size-4" />
    </span>
  );
}

export function ProjectChip({ project }: { project: Pick<ProjectDto, 'name' | 'color'> | undefined }) {
  if (!project) return null;
  return (
    <Badge variant="outline" className="max-w-40 gap-1.5 font-normal">
      <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: project.color }} aria-hidden />
      <span className="truncate">{project.name}</span>
    </Badge>
  );
}

export function DocumentCard({
  doc,
  project,
  to,
}: {
  doc: DocumentSummaryDto;
  project?: Pick<ProjectDto, 'name' | 'color'>;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2">
        <DocumentIcon icon={doc.icon} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{doc.title}</h3>
        {doc.isArchived ? <Badge variant="secondary">Archived</Badge> : null}
      </div>
      <p className="line-clamp-2 min-h-[2.5em] text-[13px] text-muted-foreground">{doc.excerpt || 'Empty document'}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
        <ProjectChip project={project} />
        <span className="ml-auto inline-flex items-center gap-1.5" title={formatDateTime(doc.updatedAt)}>
          <UserAvatar user={doc.updatedBy} size="xs" />
          {formatRelative(doc.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
