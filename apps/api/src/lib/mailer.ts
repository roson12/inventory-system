import nodemailer from 'nodemailer';
import { env } from '../config/env';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    if (env.isProduction) {
      // eslint-disable-next-line no-console
      console.error('[mailer] SMTP is not configured; password reset email was not sent');
      return;
    }
    // Development-only convenience. Never logged in production.
    // eslint-disable-next-line no-console
    console.info(`[mailer:dev] Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Reset your inventory system password',
    text: `Use this link to reset your password. It expires in 60 minutes.\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Use the link below to reset your password. It expires in 60 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}
