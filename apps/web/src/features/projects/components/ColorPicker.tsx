import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PROJECT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#64748b',
] as const;

export function ColorPicker({
  value,
  onChange,
  colors = PROJECT_COLORS,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  colors?: readonly string[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {colors.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'scale-110 ring-2 ring-offset-2 ring-offset-card ring-foreground/40' : 'hover:scale-105',
            )}
            style={{ backgroundColor: c }}
          >
            {selected ? <Check className="size-3.5 text-white" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
