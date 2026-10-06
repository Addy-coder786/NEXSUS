import type { ActivityDto } from '@nexus/shared';
import { humanize } from '@/lib/utils';

export interface ActivitySentence {
  /** Verb phrase after the actor name, e.g. `changed priority from Medium to High on` */
  verb: string;
  /** Optional target title appended after the verb (rendered as a link when possible). */
  target: string | null;
  /** Extra trailing text, e.g. a quoted comment snippet. */
  suffix?: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function prettyValue(field: string | null, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') {
    if (field === 'dueDate' || field === 'startDate') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
    }
    if (/^[A-Z_]+$/.test(value)) return humanize(value);
    return value;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return str(rec.name) ?? str(rec.title) ?? JSON.stringify(value);
  }
  return String(value);
}

/** Builds a human sentence for an activity. */
export function describeActivity(a: ActivityDto): ActivitySentence {
  const title = a.target?.title ?? null;
  const m = a.metadata ?? {};
  const field = str(m.field);

  switch (a.type) {
    case 'WORKSPACE_CREATED':
      return { verb: 'created the workspace', target: title };
    case 'WORKSPACE_UPDATED':
      return { verb: 'updated workspace settings', target: null };
    case 'MEMBER_JOINED':
      return { verb: 'joined the workspace', target: null };
    case 'MEMBER_REMOVED':
      return { verb: 'removed', target: title ?? str(m.userName) ?? 'a member' };
    case 'MEMBER_ROLE_CHANGED':
      return {
        verb: `changed the role of ${title ?? str(m.userName) ?? 'a member'} from ${prettyValue('role', m.from)} to ${prettyValue('role', m.to)}`,
        target: null,
      };
    case 'INVITATION_SENT':
      return { verb: `invited ${str(m.email) ?? title ?? 'someone'} as ${prettyValue('role', m.role)}`, target: null };
    case 'INVITATION_REVOKED':
      return { verb: `revoked the invitation for ${str(m.email) ?? title ?? 'someone'}`, target: null };
    case 'PROJECT_CREATED':
      return { verb: 'created project', target: title };
    case 'PROJECT_UPDATED':
      if (field) {
        return {
          verb: `changed ${humanize(field).toLowerCase()} from ${prettyValue(field, m.from)} to ${prettyValue(field, m.to)} on`,
          target: title,
        };
      }
      return { verb: 'updated project', target: title };
    case 'PROJECT_DELETED':
      return { verb: 'deleted project', target: title };
    case 'PROJECT_MEMBER_ADDED':
      return { verb: `added ${str(m.userName) ?? 'a member'} to`, target: title };
    case 'PROJECT_MEMBER_REMOVED':
      return { verb: `removed ${str(m.userName) ?? 'a member'} from`, target: title };
    case 'TASK_CREATED':
      return { verb: 'created', target: title };
    case 'TASK_UPDATED':
      if (field) {
        return {
          verb: `changed ${humanize(field).toLowerCase()} from ${prettyValue(field, m.from)} to ${prettyValue(field, m.to)} on`,
          target: title,
        };
      }
      return { verb: 'updated', target: title };
    case 'TASK_DELETED':
      return { verb: 'deleted', target: title };
    case 'TASK_MOVED':
      return {
        verb: `moved${m.from ? ` from ${prettyValue('status', m.from)}` : ''}${m.to ? ` to ${prettyValue('status', m.to)}` : ''}`,
        target: title,
      };
    case 'TASK_ASSIGNED': {
      const assignee = str(m.assigneeName) ?? str(m.to);
      return { verb: assignee ? `assigned ${assignee} to` : 'unassigned', target: title };
    }
    case 'TASK_COMPLETED':
      return { verb: 'completed', target: title };
    case 'COMMENT_ADDED':
      return { verb: 'commented on', target: title, suffix: str(m.snippet) ?? str(m.body) ?? undefined };
    case 'COMMENT_UPDATED':
      return { verb: 'edited a comment on', target: title };
    case 'COMMENT_DELETED':
      return { verb: 'deleted a comment on', target: title };
    // Phase 2 activities carry their subject in metadata (target is null).
    case 'DOCUMENT_CREATED':
      return { verb: m.duplicatedFrom ? 'duplicated a document as' : 'created document', target: title ?? str(m.title) };
    case 'DOCUMENT_UPDATED':
      return { verb: 'edited document', target: title ?? str(m.title) };
    case 'DOCUMENT_DELETED':
      return { verb: 'deleted document', target: title ?? str(m.title) };
    case 'FILE_UPLOADED':
      return { verb: 'uploaded', target: title ?? str(m.name) ?? 'a file' };
    case 'FILE_DELETED':
      return { verb: 'deleted file', target: title ?? str(m.name) };
    case 'CHANNEL_CREATED':
      return {
        verb: m.source === 'slack' ? 'synced a Slack channel' : 'created channel',
        target: str(m.name) ? `#${str(m.name)}` : null,
      };
    case 'CHANNEL_ARCHIVED':
      return { verb: 'archived channel', target: str(m.name) ? `#${str(m.name)}` : null };
    case 'INTEGRATION_CONNECTED':
      return { verb: `connected ${str(m.teamName) ? `the Slack workspace ${str(m.teamName)}` : 'Slack'}`, target: null };
    case 'INTEGRATION_DISCONNECTED':
      return { verb: 'disconnected Slack', target: null };
    default:
      return { verb: humanize(a.type).toLowerCase(), target: title };
  }
}
