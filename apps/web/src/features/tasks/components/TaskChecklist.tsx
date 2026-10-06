import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ChecklistItem } from '@nexus/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TaskChecklistProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  disabled?: boolean;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TaskChecklist({ items, onChange, disabled = false }: TaskChecklistProps) {
  const [draft, setDraft] = useState('');
  const done = items.filter((i) => i.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: newId(), text, done: false }]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Checklist</h3>
        {items.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {done}/{items.length}
          </span>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-success transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      ) : null}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2">
            <Checkbox
              id={`check-${item.id}`}
              checked={item.done}
              disabled={disabled}
              onCheckedChange={(v) => onChange(items.map((i) => (i.id === item.id ? { ...i, done: v === true } : i)))}
            />
            <label
              htmlFor={`check-${item.id}`}
              className={cn('flex-1 text-[13px]', item.done && 'text-muted-foreground line-through')}
            >
              {item.text}
            </label>
            {!disabled ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove "${item.text}"`}
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add checklist item"
            aria-label="New checklist item"
            className="h-7 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
            <Plus /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
