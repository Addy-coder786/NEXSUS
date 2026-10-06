import type { LabelDto } from '@nexus/shared';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LabelPickerProps {
  labels: LabelDto[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** Toggleable label chips. */
export function LabelPicker({ labels, value, onChange, disabled = false }: LabelPickerProps) {
  const toggle = (id: string) => {
    if (disabled) return;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  if (labels.length === 0) return <p className="text-xs text-muted-foreground">No labels in this project yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Labels">
      {labels.map((l) => {
        const selected = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => toggle(l.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed',
              selected ? 'border-transparent' : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
            style={selected ? { backgroundColor: `${l.color}22`, color: l.color } : undefined}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
            {l.name}
            {selected ? <Check className="size-3" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
