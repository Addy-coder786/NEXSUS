import { useProjectContext } from '@/features/projects/pages/ProjectLayout';
import { FilesBrowser } from '../components/FilesBrowser';

export function ProjectFilesPage() {
  const project = useProjectContext();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FilesBrowser workspaceId={project.workspaceId} projectId={project.id} />
    </div>
  );
}
