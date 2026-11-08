import type { PlatformRole } from '@prisma/client';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { mailConfigured, sendMail } from '../../lib/mailer.js';

/**
 * In-app notifications are always stored. When SMTP is configured, the same notification is
 * also emailed to recipients who have email notifications switched on (User.emailNotifications).
 * Email problems are logged and never fail the action that produced the notification.
 */

type MailLog = { info: (o: object, m: string) => void; error?: (o: object, m: string) => void };
const consoleLog: MailLog = {
  info: (o, m) => console.log(m, JSON.stringify(o)),
  error: (o, m) => console.error(m, JSON.stringify(o)),
};

export interface NotifyOptions {
  /** Also send an email (default true). In-app notifications are created either way. */
  email?: boolean;
  log?: MailLog;
}

interface Recipient {
  email: string;
  name: string;
}

export function notificationEmailText(r: { name: string }, title: string, body: string, link: string | undefined, area: 'app' | 'admin') {
  const url = link ? `${config.APP_BASE_URL}${link}` : `${config.APP_BASE_URL}/${area === 'admin' ? 'admin' : 'app/notifications'}`;
  const where = area === 'admin' ? 'your administrator account' : 'Settings → Account & security';
  return [
    `Hello ${r.name},`,
    '',
    title,
    '',
    body,
    '',
    `Open in InvoiceGO: ${url}`,
    '',
    '—',
    `You receive this email because email notifications are switched on. You can turn them off in ${where}.`,
  ].join('\n');
}

/** Sends one email per recipient. Never throws; returns how many were sent. */
export async function emailRecipients(recipients: Recipient[], title: string, body: string, link: string | undefined, area: 'app' | 'admin', log: MailLog = consoleLog) {
  if (!mailConfigured() || recipients.length === 0) return 0;
  const results = await Promise.allSettled(
    recipients.map((r) => sendMail(r.email, `[InvoiceGO] ${title}`, notificationEmailText(r, title, body, link, area), log)),
  );
  let sent = 0;
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') sent++;
    else (log.error ?? log.info)({ to: recipients[i].email, err: String((res.reason as Error)?.message ?? res.reason) }, 'notification email could not be sent');
  });
  return sent;
}

const activeUser = { status: 'ACTIVE' as const, deletedAt: null, emailNotifications: true };

/** Notify every member of a business. */
export async function notifyBusiness(businessId: string, type: string, title: string, body: string, link?: string, opts: NotifyOptions = {}) {
  const members = await prisma.membership.findMany({ where: { businessId }, select: { userId: true, user: { select: { email: true, name: true, status: true, deletedAt: true, emailNotifications: true } } } });
  if (members.length === 0) return;
  await prisma.notification.createMany({
    data: members.map((m) => ({ userId: m.userId, businessId, audience: 'USER', type, title, body, link })),
  });
  if (opts.email === false) return;
  const to = members.filter((m) => m.user.status === 'ACTIVE' && !m.user.deletedAt && m.user.emailNotifications).map((m) => m.user);
  await emailRecipients(to, title, body, link, 'app', opts.log);
}

const ADMIN_ROLES_DEFAULT: PlatformRole[] = ['SUPER_ADMIN', 'ADMIN'];

/** Notify platform administrators (shown in the admin panel; emailed to the given roles). */
export async function notifyAdmins(type: string, title: string, body: string, link?: string, businessId?: string, opts: NotifyOptions & { roles?: PlatformRole[] } = {}) {
  await prisma.notification.create({ data: { audience: 'ADMINS', type, title, body, link, businessId } });
  if (opts.email === false) return;
  const admins = await prisma.user.findMany({
    where: { ...activeUser, platformRole: { in: opts.roles ?? ADMIN_ROLES_DEFAULT }, totpEnabledAt: { not: null } },
    select: { email: true, name: true },
  });
  await emailRecipients(admins, title, body, link, 'admin', opts.log);
}

export async function notifyUser(userId: string, type: string, title: string, body: string, link?: string, opts: NotifyOptions = {}) {
  await prisma.notification.create({ data: { userId, audience: 'USER', type, title, body, link } });
  if (opts.email === false) return;
  const u = await prisma.user.findFirst({ where: { id: userId, ...activeUser }, select: { email: true, name: true } });
  if (u) await emailRecipients([u], title, body, link, 'app', opts.log);
}
