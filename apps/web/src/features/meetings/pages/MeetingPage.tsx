import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ListPlus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MeetingActionItemDto, MeetingDetailDto } from '@nexus/shared';
import { MeetingStatusBadge } from '../components/MeetingStatusBadge';
import { useAnalyzeMeeting, useConvertActionItems, useDeleteMeeting, useMeeting } from '../hooks';
import { NotFound } from '@/components/common/NotFound';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton';
import { useAiEnabled } from '@/features/ai/hooks';
import { PRIORITY_LABELS } from '@/features/tasks/constants';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { getErrorMessage, isApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth.store';

export function MeetingPage() {
  const { workspaceId = '', meetingId = '' } = useParams<{
    workspaceId: string;
    meetingId: string;
  }>();
  const meeting = useMeeting(meetingId);

  if (meeting.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-6 w-1/2" />
        <SkeletonLines lines={8} />
      </div>
    );
  }
  if (meeting.isError || !meeting.data) {
    const nf =
      isApiError(meeting.error) && (meeting.error.status === 404 || meeting.error.status === 403);
    return (
      <NotFound
        title={nf ? 'Meeting not found' : 'Could not load meeting'}
        description={
          nf
            ? 'This meeting does not exist or you do not have access to it.'
            : meeting.error?.message
        }
        to={`/w/${workspaceId}/meetings`}
        actionLabel="Back to meetings"
      />
    );
  }
  return <MeetingView meeting={meeting.data} workspaceId={workspaceId} />;
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="list-disc space-y-1 pl-4 text-[13px]">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">None.</p>
        )}
      </CardContent>
    </Card>
  );
}

function MeetingView({ meeting, workspaceId }: { meeting: MeetingDetailDto; workspaceId: string }) {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const { can } = usePermissions();
  const aiEnabled = useAiEnabled();
  const analyze = useAnalyzeMeeting(meeting.id);
  const convert = useConvertActionItems(meeting.id);
  const remove = useDeleteMeeting(workspaceId);
  const projects = useWorkspaceProjects(workspaceId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState(meeting.projectId ?? '');

  const openItems = useMemo(
    () => meeting.analysis?.actionItems.filter((i) => !i.taskId) ?? [],
    [meeting.analysis],
  );
  useEffect(() => setSelected(new Set(openItems.map((i) => i.id))), [openItems]);

  const canDelete = can('meeting:delete') || meeting.createdBy.id === me?.id;
  const canConvert = can('task:create');
  const working = meeting.status === 'PENDING' || meeting.status === 'PROCESSING';
  const a = meeting.analysis;

  const onConvert = () =>
    convert.mutate(
      { actionItemIds: [...selected], projectId },
      {
        onSuccess: (tasks) =>
          toast.success(`Created ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`, {
            action: {
              label: 'Open board',
              onClick: () => navigate(`/w/${workspaceId}/projects/${projectId}/board`),
            },
          }),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );

  const taskLink = (item: MeetingActionItemDto) =>
    `/w/${workspaceId}/projects/${projectId || meeting.projectId}/board?task=${item.taskId}`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-col gap-2 border-b px-6 py-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
          <Link to={`/w/${workspaceId}/meetings`}>
            <ChevronLeft /> Meetings
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
              {meeting.title} <MeetingStatusBadge status={meeting.status} />
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              {formatDate(meeting.occurredAt)}
              {meeting.projectId ? (
                <>· {projects.data?.find((p) => p.id === meeting.projectId)?.name ?? 'Project'}</>
              ) : null}
              {meeting.attendees.length ? (
                <span className="flex -space-x-1.5">
                  {meeting.attendees.map((u) => (
                    <UserAvatar key={u.id} user={u} size="xs" />
                  ))}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {aiEnabled && can('meeting:create') && !working ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  analyze.mutate(undefined, { onError: (e) => toast.error(getErrorMessage(e)) })
                }
                loading={analyze.isPending}
              >
                <RefreshCw /> Re-analyse
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete meeting"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {working ? (
            <Card>
              <CardContent className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> Analysing the transcript. This usually
                takes under a minute.
              </CardContent>
            </Card>
          ) : null}
          {meeting.status === 'FAILED' ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
            >
              Analysis failed: {meeting.error ?? 'unknown error'}
            </p>
          ) : null}

          {a ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{a.summary}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-sm">Action items</CardTitle>
                  {canConvert && openItems.length ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={projectId}
                        onValueChange={setProjectId}
                        disabled={Boolean(meeting.projectId)}
                      >
                        <SelectTrigger className="h-8 w-48" aria-label="Project for new tasks">
                          <SelectValue placeholder="Choose a project" />
                        </SelectTrigger>
                        <SelectContent>
                          {(projects.data ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={onConvert}
                        disabled={!projectId || selected.size === 0}
                        loading={convert.isPending}
                      >
                        <ListPlus /> Create {selected.size} {selected.size === 1 ? 'task' : 'tasks'}
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {a.actionItems.length ? (
                    <ul className="space-y-2">
                      {a.actionItems.map((item) => (
                        <li key={item.id} className="flex items-start gap-2 text-[13px]">
                          {item.taskId ? (
                            <Badge variant="success" className="mt-0.5">
                              Task
                            </Badge>
                          ) : canConvert ? (
                            <Checkbox
                              className="mt-0.5"
                              aria-label={`Select ${item.text}`}
                              checked={selected.has(item.id)}
                              onCheckedChange={(v) =>
                                setSelected((s) => {
                                  const next = new Set(s);
                                  if (v === true) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                })
                              }
                            />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            {item.taskId ? (
                              <Link to={taskLink(item)} className="text-primary hover:underline">
                                {item.text}
                              </Link>
                            ) : (
                              <span>{item.text}</span>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {PRIORITY_LABELS[item.priority]}
                              {item.ownerName
                                ? ` · ${item.ownerName}${item.ownerId ? '' : ' (not matched to a member)'}`
                                : ' · No owner'}
                              {item.dueHint ? ` · ${item.dueHint}` : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">No action items were found.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Decisions</CardTitle>
                </CardHeader>
                <CardContent>
                  {a.decisions.length ? (
                    <ul className="list-disc space-y-1 pl-4 text-[13px]">
                      {a.decisions.map((d, i) => (
                        <li key={i}>
                          {d.text}
                          {d.context ? (
                            <span className="text-muted-foreground"> · {d.context}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">None.</p>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <List title="Open questions" items={a.openQuestions} />
                <List title="Risks" items={a.risks} />
              </div>
            </>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Transcript</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTranscript((v) => !v)}
                aria-expanded={showTranscript}
              >
                {showTranscript ? 'Hide' : 'Show'}
              </Button>
            </CardHeader>
            {showTranscript ? (
              <CardContent>
                <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                  {meeting.transcript}
                </pre>
              </CardContent>
            ) : null}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this meeting?"
        description="The transcript and its analysis are removed. Tasks created from it are kept."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(meeting.id, {
            onSuccess: () => navigate(`/w/${workspaceId}/meetings`, { replace: true }),
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
