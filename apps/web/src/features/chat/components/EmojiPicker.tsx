import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Curated reaction set; keep it small so the grid stays keyboard friendly. */
export const EMOJI_SET = [
  '👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '🔥',
  '👀', '✅', '🚀', '💯', '🙏', '👏', '😍', '🤔',
  '😅', '🙌', '💪', '⭐', '🐛', '☕', '🎯', '⚡',
] as const;

const COLUMNS = 8;

interface EmojiPickerProps {
  trigger: ReactNode;
  onPick: (emoji: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
}

/** Emoji grid in a popover with roving focus (arrow keys, Home/End, Enter/Space). */
export function EmojiPicker({ trigger, onPick, open, onOpenChange, align = 'end', side = 'top' }: EmojiPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [active, setActive] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (isOpen) {
      setActive(0);
      const id = requestAnimationFrame(() => buttons.current[0]?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isOpen]);

  const move = (next: number) => {
    const clamped = (next + EMOJI_SET.length) % EMOJI_SET.length;
    setActive(clamped);
    buttons.current[clamped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        move(active + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        move(active - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(active + COLUMNS);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(active - COLUMNS);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(EMOJI_SET.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side={side} className="w-auto p-2" onKeyDown={onKeyDown}>
        <div role="grid" aria-label="Pick an emoji" className="grid grid-cols-8 gap-0.5">
          {EMOJI_SET.map((emoji, i) => (
            <button
              key={emoji}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="gridcell"
              tabIndex={i === active ? 0 : -1}
              aria-label={emoji}
              onFocus={() => setActive(i)}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-md text-lg leading-none hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
