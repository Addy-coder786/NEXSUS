export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const USER_AVAILABILITY = ['AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE'] as const;
export type UserAvailability = (typeof USER_AVAILABILITY)[number];

export const OAUTH_PROVIDERS = ['google', 'slack'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const ACTIVITY_TYPES = [
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'PROJECT_MEMBER_ADDED',
  'PROJECT_MEMBER_REMOVED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'TASK_MOVED',
  'TASK_ASSIGNED',
  'TASK_COMPLETED',
  'COMMENT_ADDED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'MEMBER_JOINED',
  'MEMBER_REMOVED',
  'MEMBER_ROLE_CHANGED',
  'INVITATION_SENT',
  'INVITATION_REVOKED',
  'DOCUMENT_CREATED',
  'DOCUMENT_UPDATED',
  'DOCUMENT_DELETED',
  'FILE_UPLOADED',
  'FILE_DELETED',
  'CHANNEL_CREATED',
  'CHANNEL_ARCHIVED',
  'INTEGRATION_CONNECTED',
  'INTEGRATION_DISCONNECTED',
  'AI_TASKS_GENERATED',
  'MEETING_CREATED',
  'MEETING_ANALYZED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const CHANNEL_TYPES = ['PUBLIC', 'PRIVATE', 'DM', 'GROUP'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const MESSAGE_SOURCES = ['nexus', 'slack', 'system'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'TASK_COMPLETED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'MENTION',
  'COMMENT_ADDED',
  'NEW_MESSAGE',
  'PROJECT_UPDATED',
  'FILE_UPLOADED',
  'DOCUMENT_SHARED',
  'MEMBER_JOINED',
  'AI_TASK_CREATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const FILE_KINDS = ['image', 'pdf', 'video', 'audio', 'document', 'archive', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const SEARCH_TYPES = ['tasks', 'projects', 'documents', 'messages', 'files', 'users'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const PROJECT_HEALTH = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];

export const INTEGRATION_PROVIDERS = ['slack'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 4000;
export const DOCUMENT_VERSIONS_KEPT = 25;
export const TYPING_TTL_MS = 4000;
export const PRESENCE_TTL_SEC = 90;

export const PASSWORD_MIN_LENGTH = 8;
export const WORKSPACE_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;
export const REFRESH_TOKEN_REMEMBER_TTL_SEC = 30 * 24 * 60 * 60;
export const INVITATION_TTL_SEC = 7 * 24 * 60 * 60;
