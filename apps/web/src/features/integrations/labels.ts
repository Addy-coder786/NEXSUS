import type { NotificationType } from '@nexus/shared';

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  TASK_ASSIGNED: 'Task assigned',
  TASK_COMPLETED: 'Task completed',
  TASK_DUE_SOON: 'Task due soon',
  TASK_OVERDUE: 'Task overdue',
  MENTION: 'Mentions',
  COMMENT_ADDED: 'New comments',
  NEW_MESSAGE: 'Direct messages',
  PROJECT_UPDATED: 'Project updates',
  FILE_UPLOADED: 'File uploads',
  DOCUMENT_SHARED: 'Documents shared',
  MEMBER_JOINED: 'Member joined',
  AI_TASK_CREATED: 'AI-created tasks',
};
