import type { UserPublicDto } from '@nexus/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { usePresence } from '@/features/realtime/presence.store';
import { cn, initials } from '@/lib/utils';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<Size, string> = {
  xs: 'size-5 [&_span]:text-[9px]',
  sm: 'size-6 [&_span]:text-[10px]',
  md: 'size-7',
  lg: 'size-9 [&_span]:text-xs',
  xl: 'size-16 [&_span]:text-lg',
};

const dotClass: Record<Size, string> = {
  xs: 'size-1.5 ring-1',
  sm: 'size-2 ring-[1.5px]',
  md: 'size-2 ring-2',
  lg: 'size-2.5 ring-2',
  xl: 'size-3.5 ring-2',
};

/** Deterministic pastel background from a string so fallbacks are distinguishable. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function UserAvatar({
  user,
  size = 'md',
  className,
  showPresence = false,
}: {
  user: Pick<UserPublicDto, 'name' | 'avatarUrl'> & { id?: string } | null | undefined;
  size?: Size;
  className?: string;
  /** Render a presence dot (green online, amber away, none when offline). */
  showPresence?: boolean;
}) {
  const name = user?.name ?? 'Unassigned';
  const hue = hueFor(user?.id ?? name);
  const presence = usePresence(showPresence ? user?.id : undefined);
  const avatar = (
    <Avatar className={cn(sizeClass[size], !showPresence && className)} title={name}>
      {user?.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={name} /> : null}
      <AvatarFallback
        style={
          user
            ? { backgroundColor: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }
            : undefined
        }
        className={cn('dark:brightness-90', !user && 'border border-dashed bg-transparent text-muted-foreground')}
      >
        {user ? initials(name) : '?'}
      </AvatarFallback>
    </Avatar>
  );
  if (!showPresence) return avatar;
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {avatar}
      {presence !== 'offline' ? (
        <span
          data-testid="presence-dot"
          role="img"
          aria-label={presence === 'online' ? 'Online' : 'Away'}
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-background',
            dotClass[size],
            presence === 'online' ? 'bg-success' : 'bg-warning',
          )}
        />
      ) : null}
    </span>
  );
}
