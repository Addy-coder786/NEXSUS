import type { WorkspaceRole } from '@nexus/shared';
import { env } from '../../config/env';
import { emailButton, emailLayout, type EmailMessage } from '../../services/email';

export interface InvitationEmailInput {
  to: string;
  token: string;
  workspaceName: string;
  inviterName: string;
  role: WorkspaceRole;
  expiresAt: Date;
}

export function invitationLink(token: string): string {
  return `${env.CLIENT_URL}/invite/${token}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const link = invitationLink(input.token);
  const workspace = escapeHtml(input.workspaceName);
  const inviter = escapeHtml(input.inviterName);
  const role = input.role.charAt(0) + input.role.slice(1).toLowerCase();
  const expires = input.expiresAt.toUTCString();

  const html = emailLayout(
    `You're invited to ${workspace}`,
    `<p><strong>${inviter}</strong> invited you to join the <strong>${workspace}</strong> workspace on NEXUS as a <strong>${role}</strong>.</p>
${emailButton(link, 'Accept invitation')}
<p style="font-size:13px;color:#6b7280">This invitation expires on ${expires}.</p>`,
  );

  const text = `${input.inviterName} invited you to join the ${input.workspaceName} workspace on NEXUS as a ${role}.

Accept the invitation: ${link}

This invitation expires on ${expires}.`;

  return { to: input.to, subject: `${input.inviterName} invited you to ${input.workspaceName} on NEXUS`, html, text };
}
