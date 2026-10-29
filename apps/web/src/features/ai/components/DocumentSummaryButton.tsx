import { useState } from 'react';
import { ListPlus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentDto, DocumentSummaryResultDto } from '@nexus/shared';
import { useAiEnabled, useSummarizeDocument } from '../hooks';
import { GenerateTasksDialog } from './GenerateTasksDialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCan } from '@/lib/permissions';
import { getErrorMessage } from '@/lib/api';

/** "Summarize" popover in the document header, with "Create tasks from this document". */
export function DocumentSummaryButton({ document }: { document: DocumentDto }) {
  const enabled = useAiEnabled();
  const canGenerate = useCan('ai:generate');
  const summarize = useSummarizeDocument();
  const [length, setLength] = useState<'short' | 'detailed'>('short');
  const [result, setResult] = useState<DocumentSummaryResultDto | null>(null);
  const [planning, setPlanning] = useState(false);
  if (!enabled) return null;

  const run = (l: 'short' | 'detailed') => {
    setLength(l);
    summarize.mutate(
      { documentId: document.id, version: document.version, length: l },
      {
        onSuccess: setResult,
        onError: (e) => toast.error(getErrorMessage(e, 'Could not summarize')),
      },
    );
  };
  const stale = result && result.version !== document.version;

  return (
    <>
      <Popover
        onOpenChange={(open) => open && (!result || stale) && !summarize.isPending && run(length)}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Sparkles /> Summarize
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Summary</h3>
            <div className="flex gap-1">
              {(['short', 'detailed'] as const).map((l) => (
                <Button
                  key={l}
                  size="sm"
                  variant={length === l ? 'secondary' : 'ghost'}
                  onClick={() => run(l)}
                  disabled={summarize.isPending}
                >
                  {l === 'short' ? 'Short' : 'Detailed'}
                </Button>
              ))}
            </div>
          </div>
          {summarize.isPending ? (
            <p className="animate-pulse text-[13px] text-muted-foreground">Reading the document…</p>
          ) : result ? (
            <div className="max-h-80 space-y-2 overflow-y-auto text-[13px]">
              <p className="whitespace-pre-wrap leading-relaxed">{result.summary}</p>
              {result.keyPoints.length ? (
                <ul className="list-disc space-y-0.5 pl-4">
                  {result.keyPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : null}
              {result.actionItems.length ? (
                <>
                  <h4 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Action items
                  </h4>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {result.actionItems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
          {canGenerate ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setPlanning(true)}
            >
              <ListPlus /> Create tasks from this document
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      {planning ? (
        <GenerateTasksDialog
          open
          onOpenChange={setPlanning}
          workspaceId={document.workspaceId}
          projectId={document.projectId ?? undefined}
          documentId={document.id}
        />
      ) : null}
    </>
  );
}
