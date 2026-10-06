import type { NotificationPreferences, NotificationType } from '@nexus/shared';
import { defineJob, enqueue } from '../../jobs';
import { Notification } from '../../models/Notification';
import { User } from '../../models/User';
import { Workspace } from '../../models/Workspace';
import { sendEmail } from '../../services/email';
import { buildNotificationEmail } from './notification.emails';

/** Which per-type preference gates email delivery. Types not listed are in-app only. */
export const EMAIL_PREFERENCE: Partial<Record<NotificationType, keyof NotificationPreferences>> = {
  TASK_ASSIGNED: 'taskAssigned',
  TASK_COMPLETED: 'taskCompleted',
  MENTION: 'mentions',
  COMMENT_ADDED: 'comments',
  TASK_DUE_SOON: 'deadlines',
  TASK_OVERDUE: 'deadlines',
};

defineJob('email.send', async (data) => {
  await sendEmail({ to: data.to, subject: data.subject, html: data.html, text: data.text });
});

/**
 * Emails the recipient when `preferences.notifications.email` and the type-specific preference
 * allow it, then stamps `emailedAt` so retries never double-send. Slack delivery lives in the
 * Slack listener.
 */
defineJob('notification.deliver', async ({ notificationId }) => {
  const notification = await Notification.findById(notificationId).lean();
  if (!notification || notification.emailedAt) return;

  const preferenceKey = EMAIL_PREFERENCE[notification.type];
  if (!preferenceKey) return;

  const user = await User.findById(notification.userId).select('email preferences deletedAt').lean();
  if (!user || user.deletedAt) return;
  const prefs = user.preferences.notifications;
  if (!prefs.email || !prefs[preferenceKey]) return;

  const workspace = await Workspace.findById(notification.workspaceId).select('name').lean();
  await enqueue(
    'email.send',
    buildNotificationEmail({
      to: user.email,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      workspaceName: workspace?.name ?? null,
    }),
  );
  await Notification.updateOne({ _id: notification._id }, { $set: { emailedAt: new Date() } });
});
