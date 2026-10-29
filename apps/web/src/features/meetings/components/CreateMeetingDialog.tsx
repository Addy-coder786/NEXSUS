import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateMeeting } from '../hooks';
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
import { useMembers, useWorkspaceProjects } from '@/features/workspaces/hooks';
import { getErrorMessage } from '@/lib/api';

const NO_PROJECT = 'none';
const MAX_TRANSCRIPT = 200_000;

export function CreateMeetingDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreateMeeting(workspaceId);
  const projects = useWorkspaceProjects(open ? workspaceId : undefined);
  const members = useMembers(open ? workspaceId : undefined);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [date, setDate] = useState('');
  const [transcript, setTranscript] = useState('');
  const [attendees, setAttendees] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setProjectId(NO_PROJECT);
    setDate(new Date().toISOString().slice(0, 10));
    setTranscript('');
    setAttendees(new Set());
  }, [open]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_TRANSCRIPT * 4)
      return toast.error('That file is too large for a transcript');
    const content = await file.text();
    setTranscript(content.slice(0, MAX_TRANSCRIPT));
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
  };

  const valid = title.trim().length > 0 && transcript.trim().length >= 20;

  const submit = () =>
    create.mutate(
      {
        title: title.trim(),
        projectId: projectId === NO_PROJECT ? null : projectId,
        occurredAt: date ? new Date(`${date}T12:00:00`) : undefined,
        transcript: transcript.trim(),
        attendeeIds: [...attendees],
      },
      {
        onSuccess: (meeting) => {
          onOpenChange(false);
          navigate(`/w/${workspaceId}/meetings/${meeting.id}`);
        },
        onError: (e) => toast.error(getErrorMessage(e, 'Could not save the meeting')),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New meeting notes</DialogTitle>
          <DialogDescription>
            Paste a transcript or notes. AI extracts the summary, decisions and action items.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-title">Title</Label>
              <Input
                id="meeting-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sprint planning"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-date">Date</Label>
              <Input
                id="meeting-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="meeting-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>No project (whole workspace)</SelectItem>
                {(projects.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Attendees</legend>
            <div className="flex max-h-28 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-2">
              {(members.data ?? []).map((m) => (
                <label key={m.user.id} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox
                    checked={attendees.has(m.user.id)}
                    onCheckedChange={(v) =>
                      setAttendees((s) => {
                        const next = new Set(s);
                        if (v === true) next.add(m.user.id);
                        else next.delete(m.user.id);
                        return next;
                      })
                    }
                  />
                  {m.user.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="meeting-transcript">Transcript or notes</Label>
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
                <Upload className="size-3" /> Upload .txt / .vtt / .md
                <input
                  type="file"
                  accept=".txt,.vtt,.srt,.md,text/plain"
                  className="sr-only"
                  onChange={(e) => void onFile(e)}
                />
              </label>
            </div>
            <Textarea
              id="meeting-transcript"
              rows={10}
              value={transcript}
              maxLength={MAX_TRANSCRIPT}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={
                'Maya: I can take the login fix by Thursday.\nSam: Let’s ship the beta on Friday.'
              }
            />
            <p className="text-xs text-muted-foreground">
              “Name: what they said” per line works best.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!valid}>
            Save and analyse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
