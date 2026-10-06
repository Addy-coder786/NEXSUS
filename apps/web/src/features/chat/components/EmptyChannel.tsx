import { Hash, Lock, MessageSquare, Users } from 'lucide-react';
import type { ChannelDto } from '@nexus/shared';
import { formatDate } from '@/lib/format';

/** Intro block shown at the top of a channel's history (and alone when it has no messages). */
export function EmptyChannel({ channel }: { channel: ChannelDto }) {
  const isDm = channel.type === 'DM';
  const Icon = isDm ? MessageSquare : channel.type === 'PRIVATE' ? Lock : channel.type === 'GROUP' ? Users : Hash;
  return (
    <div className="max-w-xl">
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">
        {isDm ? `This is the start of your conversation with ${channel.name}` : `Welcome to #${channel.slug}`}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {channel.description
          ? channel.description
          : isDm
            ? 'Messages here are private between the two of you.'
            : channel.projectId
              ? 'This channel is linked to a project. Use it for updates, questions and decisions about the work.'
              : `Created ${formatDate(channel.createdAt)}. Say hello and start the discussion.`}
      </p>
    </div>
  );
}
