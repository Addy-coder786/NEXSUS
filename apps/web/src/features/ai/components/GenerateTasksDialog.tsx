import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  TASK_PRIORITIES,
  type CommitGeneratedTasksInput,
  type GeneratedTaskDraft,
  type ProjectDto,
  type TaskPriority,
} from '@nexus/shared';
import { useCommitTasks, useGenerateTasks } from '../hooks';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useProject } from '@/features/projects/hooks';
import { PRIORITY_LABELS } from '@/features/tasks/constants';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { getErrorMessage } from '@/lib/api';

type Source = NonNullable<CommitGeneratedTasksInput['source']>;

interface GenerateTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Fixed target project; when omitted the user picks one. */
  projectId?: string;
  /** Prefilled input (an assistant answer, a pasted spec...). */
  initialText?: string;
  documentId?: string;
  source?: Source;
}

const UNASSIGNED = 'unassigned';

/**
 * Two steps: describe the work → review AI drafts (select, edit title/priority/assignee) →
 * create. Nothing is saved until "Create tasks".
 */
export function GenerateTasksDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  initialText = '',
  documentId,
  source,
}: GenerateTasksDialogProps) {
  const [targetId, setTargetId] = useState(projectId ?? '');
  const [text, setText] = useState(initialText);
  const [instructions, setInstructions] = useState('');
  const [summary, setSummary] = useState('');
  const [drafts, setDrafts] = useState<GeneratedTaskDraft[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const navigate = useNavigate();
  const projects = useWorkspaceProjects(projectId ? undefined : workspaceId);
  const project = useProject(targetId || undefined);
  const generate = useGenerateTasks(targetId);
  const commit = useCommitTasks(targetId);

  useEffect(() => {
    if (!open) return;
    setTargetId(projectId ?? '');
    setText(initialText);
    setInstructions('');
    setDrafts(null);
    setSummary('');
  }, [open, projectId, initialText]);

  const canGenerate = Boolean(targetId) && (documentId || text.trim().length >= 10);

  const onGenerate = () =>
    generate.mutate(
      {
        ...(documentId && !text.trim() ? { documentId } : { text: text.trim() }),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      },
      {
        onSuccess: (result) => {
          setSummary(result.summary);
          setDrafts(result.tasks);
          setSelected(new Set(result.tasks.map((t) => t.draftId)));
        },
        onError: (e) => toast.error(getErrorMessage(e, 'Could not generate tasks')),
      },
    );

  const update = (draftId: string, patch: Partial<GeneratedTaskDraft>) =>
    setDrafts((list) => list?.map((d) => (d.draftId === draftId ? { ...d, ...patch } : d)) ?? null);

  const onCommit = () => {
    if (!drafts) return;
    const chosen = drafts.filter((d) => selected.has(d.draftId));
    const ids = new Set(chosen.map((d) => d.draftId));
    commit.mutate(
      {
        source: source ?? (documentId ? { type: 'document', id: documentId } : { type: 'text' }),
        tasks: chosen.map((d) => ({
          draftId: d.draftId,
          title: d.title,
          description: d.description,
          priority: d.priority,
          assigneeId: d.assigneeId,
          estimateHours: d.estimateHours,
          // References to unselected drafts are dropped so the batch stays consistent.
          dependsOnDraftIds: d.dependsOnDraftIds.filter((id) => ids.has(id)),
          parentDraftId: d.parentDraftId && ids.has(d.parentDraftId) ? d.parentDraftId : null,
        })),
      },
      {
        onSuccess: (tasks) => {
          toast.success(`Created ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`, {
            action: {
              label: 'Open board',
              onClick: () => navigate(`/w/${workspaceId}/projects/${targetId}/board`),
            },
          });
          onOpenChange(false);
        },
        onError: (e) => toast.error(getErrorMessage(e, 'Could not create tasks')),
      },
    );
  };

  const members = project.data?.members ?? [];
  const titleOf = (draftId: string) => drafts?.find((d) => d.draftId === draftId)?.title ?? draftId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />{' '}
            {drafts ? summary || 'Review tasks' : 'Generate tasks with AI'}
          </DialogTitle>
          <DialogDescription>
            {drafts
              ? 'Pick the tasks to create and adjust anything before saving.'
              : 'Describe a feature or paste a discussion. The assistant drafts tasks, and nothing is saved until you confirm.'}
          </DialogDescription>
        </DialogHeader>

        {!drafts ? (
          <div className="space-y-3">
            {!projectId ? (
              <div className="space-y-1.5">
                <Label htmlFor="gen-project">Project</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger id="gen-project">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects.data ?? []).map((p: ProjectDto) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="gen-text">
                {documentId
                  ? 'Extra context (optional; the document is used otherwise)'
                  : 'What needs to be built?'}
              </Label>
              <Textarea
                id="gen-text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="We need a payment system with Stripe checkout, invoices and refunds…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-instructions">Instructions (optional)</Label>
              <Input
                id="gen-instructions"
                value={instructions}
                maxLength={500}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Focus on the backend; keep tasks under a day"
              />
            </div>
          </div>
        ) : drafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tasks were suggested. Try adding more detail.
          </p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.draftId} className="rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    className="mt-1.5"
                    aria-label={`Include ${d.title}`}
                    checked={selected.has(d.draftId)}
                    onCheckedChange={(v) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (v === true) next.add(d.draftId);
                        else next.delete(d.draftId);
                        return next;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      aria-label="Task title"
                      value={d.title}
                      maxLength={200}
                      onChange={(e) => update(d.draftId, { title: e.target.value })}
                    />
                    {d.description ? (
                      <p className="text-[13px] text-muted-foreground">{d.description}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Select
                        value={d.priority}
                        onValueChange={(v) => update(d.draftId, { priority: v as TaskPriority })}
                      >
                        <SelectTrigger className="h-7 w-28" aria-label="Priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TASK_PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PRIORITY_LABELS[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={d.assigneeId ?? UNASSIGNED}
                        onValueChange={(v) =>
                          update(d.draftId, { assigneeId: v === UNASSIGNED ? null : v })
                        }
                      >
                        <SelectTrigger className="h-7 w-44" aria-label="Assignee">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {d.estimateHours !== null ? (
                        <span className="text-muted-foreground">~{d.estimateHours}h</span>
                      ) : null}
                      {d.parentDraftId ? (
                        <span className="text-muted-foreground">
                          Subtask of “{titleOf(d.parentDraftId)}”
                        </span>
                      ) : null}
                      {d.dependsOnDraftIds.length ? (
                        <span className="text-muted-foreground">
                          After {d.dependsOnDraftIds.map(titleOf).join(', ')}
                        </span>
                      ) : null}
                    </div>
                    {d.assigneeReason && d.assigneeId ? (
                      <p className="text-xs text-muted-foreground">
                        Suggested assignee: {d.assigneeReason}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${d.title}`}
                    onClick={() =>
                      setDrafts((list) => list?.filter((x) => x.draftId !== d.draftId) ?? null)
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {drafts ? (
            <>
              <Button variant="ghost" onClick={() => setDrafts(null)}>
                Back
              </Button>
              <Button
                onClick={onCommit}
                loading={commit.isPending}
                disabled={
                  selected.size === 0 ||
                  drafts.some((d) => selected.has(d.draftId) && !d.title.trim())
                }
              >
                Create {selected.size} {selected.size === 1 ? 'task' : 'tasks'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onGenerate} loading={generate.isPending} disabled={!canGenerate}>
                <Sparkles /> Generate
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
