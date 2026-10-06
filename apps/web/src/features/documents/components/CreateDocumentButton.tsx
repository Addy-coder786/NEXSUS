import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateDocument } from '../hooks';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useCan } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/api';

interface CreateDocumentButtonProps extends Omit<ButtonProps, 'onClick'> {
  workspaceId: string;
  /** Pre-fills the project on project-scoped pages. */
  projectId?: string | null;
  label?: string;
}

export function CreateDocumentButton({ workspaceId, projectId, label = 'New document', ...props }: CreateDocumentButtonProps) {
  const navigate = useNavigate();
  const create = useCreateDocument(workspaceId);
  const canCreate = useCan('document:create');
  if (!canCreate) return null;
  return (
    <Button
      size="sm"
      {...props}
      loading={create.isPending}
      onClick={() =>
        create.mutate(
          { title: 'Untitled', projectId: projectId ?? null },
          {
            onSuccess: (doc) => navigate(`/w/${workspaceId}/docs/${doc.id}`),
            onError: (e) => toast.error(getErrorMessage(e, 'Could not create document')),
          },
        )
      }
    >
      <Plus /> {label}
    </Button>
  );
}
