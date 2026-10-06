import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const URL_PATTERN = "https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]'\"]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(mentionNames: string[]): RegExp {
  const names = [...new Set(mentionNames.filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const mention = names.length > 0 ? `@(?:${names.join('|')}|[\\w.-]+)` : '@[\\w.-]+';
  return new RegExp(`(${URL_PATTERN})|(${mention})`, 'g');
}

export interface MessageBodyProps {
  body: string;
  /** Names that may appear as `@Name` in the body (channel members). */
  mentionNames?: string[];
  /** Current user's name; their own mention gets a stronger highlight. */
  myName?: string | null;
  className?: string;
}

/** Plain-text message body with URL linkification and @mention highlighting; whitespace is preserved. */
export const MessageBody = memo(function MessageBody({ body, mentionNames = [], myName, className }: MessageBodyProps) {
  const nodes = useMemo<ReactNode[]>(() => {
    const pattern = buildPattern(mentionNames);
    const out: ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = pattern.exec(body)) !== null) {
      if (match.index > last) out.push(<Fragment key={`t${i++}`}>{body.slice(last, match.index)}</Fragment>);
      const [full, url, mention] = match;
      if (url) {
        out.push(
          <a
            key={`u${i++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline break-all"
          >
            {url}
          </a>,
        );
      } else if (mention) {
        const isMe = Boolean(myName && mention.slice(1) === myName);
        out.push(
          <span
            key={`m${i++}`}
            className={cn(
              'rounded px-0.5 font-medium',
              isMe ? 'bg-warning/30 text-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {mention}
          </span>,
        );
      }
      last = match.index + full.length;
    }
    if (last < body.length) out.push(<Fragment key={`t${i++}`}>{body.slice(last)}</Fragment>);
    return out;
  }, [body, mentionNames, myName]);

  return <div className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-5', className)}>{nodes}</div>;
});
