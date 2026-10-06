import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ConflictBanner({ onReload, loading }: { onReload: () => void; loading?: boolean }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b bg-warning/15 px-6 py-2 text-[13px]"
    >
      <span>
        <strong>Document changed elsewhere.</strong> Reload to pick up the latest version — your unsaved edits since
        the last save will be dropped.
      </span>
      <Button size="sm" variant="outline" onClick={onReload} loading={loading}>
        <RefreshCw /> Reload
      </Button>
    </div>
  );
}
