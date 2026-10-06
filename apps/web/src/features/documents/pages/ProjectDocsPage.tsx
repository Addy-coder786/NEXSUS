import { useProjectContext } from '@/features/projects/pages/ProjectLayout';
import { DocumentList } from '../components/DocumentList';
import { CreateDocumentButton } from '../components/CreateDocumentButton';

export function ProjectDocsPage() {
  const project = useProjectContext();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 pt-3">
        <p className="text-[13px] text-muted-foreground">Documents linked to {project.name}.</p>
        <CreateDocumentButton workspaceId={project.workspaceId} projectId={project.id} />
      </div>
      <DocumentList workspaceId={project.workspaceId} projectId={project.id} className="mt-2" />
    </div>
  );
}
