import type { MeetingDto } from '@nexus/shared';
import { Badge } from '@/components/ui/badge';

const LABELS: Record<MeetingDto['status'], string> = {
  PENDING: 'Queued',
  PROCESSING: 'Analysing…',
  READY: 'Ready',
  FAILED: 'Failed',
};

export function MeetingStatusBadge({ status }: { status: MeetingDto['status'] }) {
  const variant =
    status === 'READY' ? 'success' : status === 'FAILED' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{LABELS[status]}</Badge>;
}
