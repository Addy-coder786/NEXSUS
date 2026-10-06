import { Resend } from 'resend';
import { env, features, isTest } from '../config/env';
import { logger } from '../config/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Captured messages in test mode so tests can assert on sent email without a provider. */
export const sentEmails: EmailMessage[] = [];

let client: Resend | null = null;
function getClient(): Resend | null {
  if (!features.email || !env.RESEND_API_KEY) return null;
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

/**
 * Sends an email through Resend when RESEND_API_KEY is set. Otherwise logs the message
 * (development) or records it in `sentEmails` (tests). Never throws to callers: an email
 * failure must not fail the user's request. Errors are logged.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (isTest) {
    sentEmails.push(msg);
    return;
  }
  const resend = getClient();
  if (!resend) {
    logger.info({ to: msg.to, subject: msg.subject }, `[email:console]\n${msg.text ?? msg.html}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) logger.error({ error, to: msg.to }, 'Resend rejected email');
  } catch (err) {
    logger.error({ err, to: msg.to }, 'Failed to send email');
  }
}

/** Minimal branded wrapper. Modules supply the inner HTML via their own template files. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:20px;font-weight:700;letter-spacing:-0.02em;padding-bottom:16px">NEXUS</td></tr>
<tr><td style="font-size:18px;font-weight:600;padding-bottom:12px">${title}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;color:#6b7280;padding-top:24px">If you did not expect this email, you can safely ignore it.</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${label}</a></p>
<p style="font-size:13px;color:#6b7280">Or copy this link: <br><span style="word-break:break-all">${href}</span></p>`;
}
