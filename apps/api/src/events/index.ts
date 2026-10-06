import { EventEmitter } from 'node:events';
import type {
  ActivityDto,
  ChannelDto,
  CommentDto,
  DocumentSummaryDto,
  FileDto,
  MessageDto,
  NotificationDto,
  ProjectDto,
  TaskDto,
  WorkspaceRole,
} from '@nexus/shared';
import { logger } from '../config/logger';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * In-process domain events. Services emit after a successful write; listeners fan out to
 * sockets, notifications, Slack, email, etc. Listeners must never throw into the emitter:
 * `on()` wraps handlers and logs failures.
 */
export interface DomainEvents {
  'workspace.created': { workspaceId: string; ownerId: string; name: string };
  'member.joined': { workspaceId: string; userId: string; role: WorkspaceRole; actorId: string | null };
  'member.removed': { workspaceId: string; userId: string; actorId: string };

  'project.created': { project: ProjectDto; actorId: string };
  'project.updated': { project: ProjectDto; actorId: string; changes: FieldChange[] };
  'project.deleted': { workspaceId: string; projectId: string; actorId: string };

  'task.created': { task: TaskDto; actorId: string };
  'task.updated': { task: TaskDto; actorId: string; changes: FieldChange[] };
  'task.moved': { task: TaskDto; actorId: string; from: string; to: string };
  'task.deleted': { workspaceId: string; projectId: string; taskId: string; actorId: string };
  /** Emitted by the deadline scanner job. */
  'task.due_soon': { task: TaskDto };
  'task.overdue': { task: TaskDto };

  'comment.created': { comment: CommentDto; task: TaskDto; actorId: string };

  'activity.recorded': { activity: ActivityDto };

  'channel.created': { channel: ChannelDto; actorId: string | null };
  'channel.updated': { channel: ChannelDto; actorId: string | null };
  'message.created': { message: MessageDto; channel: ChannelDto; actorId: string | null };
  'message.updated': { message: MessageDto };
  'message.deleted': { workspaceId: string; channelId: string; messageId: string; parentMessageId: string | null };

  'notification.created': { notification: NotificationDto; userId: string };

  'document.updated': { document: DocumentSummaryDto; actorId: string };
  'file.uploaded': { file: FileDto; actorId: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => void | Promise<void>;

class TypedEmitter {
  private emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): () => void {
    const wrapped = (payload: DomainEvents[K]) => {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => logger.error({ err, event }, 'Event handler failed'));
        }
      } catch (err) {
        logger.error({ err, event }, 'Event handler threw');
      }
    };
    this.emitter.on(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  /** Test helper */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}

export const events = new TypedEmitter();
