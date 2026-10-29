import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/** Shown wherever an AI feature is used while the server has no LLM credentials. */
export function AiSetupNotice({ className }: { className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={<Sparkles />}
      title="AI is not set up"
      description="Ask a workspace admin to set ANTHROPIC_API_KEY on the API server to enable the assistant, task generation, meeting notes and insights."
    />
  );
}
