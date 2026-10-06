import { useParams } from 'react-router-dom';
import { FilesBrowser } from '../components/FilesBrowser';
import { PageHeader } from '@/components/layout/PageHeader';

export function FilesPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Files" description="Everything uploaded across the workspace, its projects, tasks and chat." />
      <FilesBrowser workspaceId={workspaceId} showUsage />
    </div>
  );
}
