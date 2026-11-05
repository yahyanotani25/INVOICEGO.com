/**
 * Secure administrator bootstrap. Run on the server (never exposed over HTTP):
 *
 *   npm run admin:invite -- --email admininvoicego@gmail.com --role SUPER_ADMIN
 *   npm run admin:invite:prod -- --email admininvoicego@gmail.com --role SUPER_ADMIN [--no-email]
 *
 * Creates (or re-invites) the administrator WITHOUT a password and issues a one-time,
 * 24-hour invitation link. The administrator sets their own password, then must enrol
 * TOTP two-factor authentication at first sign-in. No default password exists anywhere.
 */
import { prisma } from '../src/db.js';
import { createAdminInvite } from '../src/modules/admin/invite.js';
import { mailConfigured, sendMail } from '../src/lib/mailer.js';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email');
  const role = (arg('role') ?? 'SUPER_ADMIN').toUpperCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: --email <address> [--role SUPER_ADMIN|ADMIN|SUPPORT|AUDITOR] [--upgrade-existing] [--no-email]');
  if (!['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'AUDITOR'].includes(role)) throw new Error('Invalid role');
  const inv = await createAdminInvite(email, role as 'SUPER_ADMIN', { allowUpgradeExisting: process.argv.includes('--upgrade-existing') });
  const log = { info: (o: object, m: string) => console.log(m, o) };
  if (mailConfigured() && !process.argv.includes('--no-email')) {
    await sendMail(email, 'InvoiceGO administrator invitation', `You have been invited as an InvoiceGO ${role}.\nSet your password within 24 hours:\n${inv.url}\nYou will be asked to enrol two-factor authentication at first sign-in.\n`, log);
    console.log(`Invitation emailed to ${email}.`);
  } else {
    console.log('\nOne-time invitation link (valid 24h). Deliver it to the administrator over a secure channel:\n');
    console.log(inv.url + '\n');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(String(e?.message ?? e));
  await prisma.$disconnect();
  process.exit(1);
});
