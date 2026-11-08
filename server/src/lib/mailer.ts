import nodemailer, { type Transporter } from 'nodemailer';
import { config, isProd } from '../config.js';

let transport: Transporter | null = null;

export function mailConfigured() {
  return !!config.SMTP_HOST;
}

export async function sendMail(to: string, subject: string, text: string, log: { info: (o: object, m: string) => void }) {
  if (!config.SMTP_HOST) {
    if (isProd) throw new Error('SMTP is not configured; cannot send email in production');
    // Development/test only: emails are written to the server log instead of being sent.
    log.info({ to, subject, text }, 'MAIL (not sent: SMTP not configured, development mode)');
    return;
  }
  if (config.MAIL_LOG_ONLY) {
    log.info({ to, subject, text }, 'MAIL (MAIL_LOG_ONLY)');
    return;
  }
  transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    // Bounded waits: a slow or unreachable mail server must not hold a request (or a serverless function) open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
}
