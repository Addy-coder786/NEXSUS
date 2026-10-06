import { useParams } from 'react-router-dom';
import { DocumentList } from '../components/DocumentList';
import { CreateDocumentButton } from '../components/CreateDocumentButton';
import { PageHeader } from '@/components/layout/PageHeader';

export function DocumentsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Documents"
        description="Specs, notes and plans for the whole workspace."
        actions={<CreateDocumentButton workspaceId={workspaceId} />}
      />
      <DocumentList workspaceId={workspaceId} />
    </div>
  );
}
