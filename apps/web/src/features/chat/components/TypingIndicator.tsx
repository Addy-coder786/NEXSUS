import type { TypingUser } from '@/features/realtime/hooks';
import { cn } from '@/lib/utils';

function label(users: TypingUser[]): string {
  const names = users.map((u) => u.name);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`;
}

export function TypingIndicator({ users, className }: { users: TypingUser[]; className?: string }) {
  const text = label(users);
  return (
    <div aria-live="polite" className={cn('flex h-5 items-center gap-1.5 px-4 text-2xs text-muted-foreground', className)}>
      {text ? (
        <>
          <span className="flex items-center gap-0.5" aria-hidden>
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground" />
          </span>
          <span>{text}</span>
        </>
      ) : null}
    </div>
  );
}
