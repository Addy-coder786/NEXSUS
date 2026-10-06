import { env } from '../../config/env';
import { emailButton, emailLayout, type EmailMessage } from '../../services/email';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface NotificationEmailInput {
  to: string;
  title: string;
  body: string | null;
  /** Client route (e.g. `/w/:ws/chat/:channelId`); the button opens `CLIENT_URL + link`. */
  link: string | null;
  workspaceName?: string | null;
}

export function buildNotificationEmail(input: NotificationEmailInput): EmailMessage {
  const href = input.link ? `${env.CLIENT_URL}${input.link}` : env.CLIENT_URL;
  const context = input.workspaceName ? `<p style="color:#6b7280;font-size:13px;margin:0 0 8px">${escapeHtml(input.workspaceName)}</p>` : '';
  const body = input.body ? `<p style="margin:0 0 8px">${escapeHtml(input.body)}</p>` : '';
  const html = emailLayout(escapeHtml(input.title), `${context}${body}${emailButton(href, 'Open in NEXUS')}`);
  const text = [input.title, input.body ?? '', '', `Open in NEXUS: ${href}`].filter((l) => l !== null).join('\n');
  return { to: input.to, subject: input.title, html, text };
}
