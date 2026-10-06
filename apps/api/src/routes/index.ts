import { Router } from 'express';
import { activityRoutes } from '../modules/activity/activity.routes';
import { analyticsRoutes } from '../modules/analytics/analytics.routes';
import { channelRoutes } from '../modules/chat/channel.routes';
import { messageRoutes } from '../modules/chat/message.routes';
import { documentRoutes } from '../modules/documents/document.routes';
import { fileRoutes } from '../modules/files/file.routes';
import { integrationRoutes } from '../modules/integrations/integration.routes';
import { slackWebhookRoutes } from '../modules/integrations/slack/slack.webhooks';
import { notificationRoutes } from '../modules/notifications/notification.routes';
import { searchRoutes } from '../modules/search/search.routes';
import { aiRoutes } from '../modules/ai/ai.routes';
import { meetingRoutes } from '../modules/meetings/meeting.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { commentRoutes } from '../modules/comments/comment.routes';
import { invitationRoutes } from '../modules/workspaces/invitation.routes';
import { projectRoutes } from '../modules/projects/project.routes';
import { taskRoutes } from '../modules/tasks/task.routes';
import { userRoutes } from '../modules/users/user.routes';
import { workspaceRoutes } from '../modules/workspaces/workspace.routes';

/**
 * Each module exports a Router mounted here. Nested resources (e.g. /workspaces/:id/projects)
 * are defined inside the parent module's router or as a standalone router using mergeParams.
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/workspaces', workspaceRoutes);
apiRouter.use('/invitations', invitationRoutes);
apiRouter.use('/projects', projectRoutes);
apiRouter.use('/tasks', taskRoutes);
apiRouter.use('/comments', commentRoutes);
apiRouter.use('/activities', activityRoutes);

// Phase 2
apiRouter.use('/channels', channelRoutes);
apiRouter.use('/messages', messageRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/documents', documentRoutes);
apiRouter.use('/files', fileRoutes);
apiRouter.use('/search', searchRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/integrations', integrationRoutes);
apiRouter.use('/integrations/slack', slackWebhookRoutes);

// Phase 3
apiRouter.use('/ai', aiRoutes);
apiRouter.use('/meetings', meetingRoutes);
