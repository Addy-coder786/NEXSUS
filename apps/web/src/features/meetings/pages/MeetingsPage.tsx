import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, Plus } from 'lucide-react';
import { CreateMeetingDialog } from '../components/CreateMeetingDialog';
import { MeetingStatusBadge } from '../components/MeetingStatusBadge';
import { useMeetings } from '../hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAiEnabled } from '@/features/ai/hooks';
import { formatDate, pluralize } from '@/lib/format';
import { useCan } from '@/lib/permissions';

export function MeetingsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const meetings = useMeetings(workspaceId);
  const canCreate = useCan('meeting:create');
  const aiEnabled = useAiEnabled();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Meetings"
        description={
          aiEnabled
            ? 'Turn transcripts into summaries, decisions and tasks.'
            : 'Meeting notes. AI analysis is not configured on this server.'
        }
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> New meeting
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-6">
        {meetings.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : meetings.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {meetings.error.message}
          </p>
        ) : meetings.data.items.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="No meetings yet"
            description="Paste a meeting transcript to get a summary, the decisions made and action items you can turn into tasks."
            action={
              canCreate ? (
                <Button onClick={() => setOpen(true)}>Add meeting notes</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="mx-auto max-w-4xl space-y-2">
            {meetings.data.items.map((m) => (
              <li key={m.id}>
                <Card className="transition-colors hover:bg-accent/40">
                  <Link
                    to={`/w/${workspaceId}/meetings/${m.id}`}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(m.occurredAt)} · {m.createdBy.name}
                        {m.analysis
                          ? ` · ${pluralize(m.analysis.actionItems.length, 'action item')}`
                          : ''}
                      </p>
                    </div>
                    <MeetingStatusBadge status={m.status} />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateMeetingDialog workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
    </div>
  );
}
