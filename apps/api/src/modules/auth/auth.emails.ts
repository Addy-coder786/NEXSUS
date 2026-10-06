import { emailButton, emailLayout, type EmailMessage } from '../../services/email';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function verificationEmail(to: string, name: string, link: string): EmailMessage {
  const safeName = escapeHtml(name);
  return {
    to,
    subject: 'Verify your email address',
    html: emailLayout(
      'Confirm your email',
      `<p>Hi ${safeName},</p>
<p>Thanks for joining NEXUS. Please confirm your email address so you can create workspaces and collaborate with your team.</p>
${emailButton(link, 'Verify email')}
<p style="font-size:13px;color:#6b7280">This link expires in 24 hours.</p>`,
    ),
    text: `Hi ${name},\n\nConfirm your email address for NEXUS by opening this link (valid for 24 hours):\n${link}\n\nIf you did not create an account, you can ignore this email.`,
  };
}

export function passwordResetEmail(to: string, name: string, link: string): EmailMessage {
  const safeName = escapeHtml(name);
  return {
    to,
    subject: 'Reset your NEXUS password',
    html: emailLayout(
      'Reset your password',
      `<p>Hi ${safeName},</p>
<p>We received a request to reset the password for your NEXUS account. Click the button below to choose a new one.</p>
${emailButton(link, 'Reset password')}
<p style="font-size:13px;color:#6b7280">This link expires in 1 hour. If you did not request a reset, no action is needed and your password stays the same.</p>`,
    ),
    text: `Hi ${name},\n\nReset your NEXUS password by opening this link (valid for 1 hour):\n${link}\n\nIf you did not request a password reset, you can ignore this email.`,
  };
}

export function passwordChangedEmail(to: string, name: string): EmailMessage {
  const safeName = escapeHtml(name);
  return {
    to,
    subject: 'Your NEXUS password was changed',
    html: emailLayout(
      'Password changed',
      `<p>Hi ${safeName},</p>
<p>The password for your NEXUS account was just changed and all other devices have been signed out.</p>
<p>If this was you, there is nothing else to do. If you did not make this change, reset your password immediately and contact support.</p>`,
    ),
    text: `Hi ${name},\n\nThe password for your NEXUS account was just changed and all other devices have been signed out.\n\nIf you did not make this change, reset your password immediately.`,
  };
}
