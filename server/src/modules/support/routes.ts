import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { sha256Hex } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { zTrim } from '../../lib/validators.js';
import { requireBusiness } from '../../plugins/auth.js';
import { notifyAdmins } from '../notifications/notify.js';

export const MAX_ATTACHMENT = 5 * 1024 * 1024; // DI User Manual §6: PDF, max 5 MB

/** Validates a PDF upload by content (magic bytes), not by the client-supplied type. */
export async function readPdf(req: { file: () => Promise<any> }) {
  const file = await req.file();
  if (!file) throw badRequest('Choose a PDF file');
  const buf: Buffer = await file.toBuffer();
  if (file.file.truncated || buf.length > MAX_ATTACHMENT) throw badRequest('Attachments must be 5 MB or smaller');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('Only PDF attachments are accepted');
  const name = String(file.filename).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'attachment.pdf';
  return { name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, buf };
}

export function ticketDto(t: any) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    category: t.category,
    queryType: t.queryType,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    closedAt: t.closedAt,
    messages: t.messages?.map((m: any) => ({ id: m.id, body: m.body, authorIsAdmin: m.authorIsAdmin, createdAt: m.createdAt })),
    attachments: t.attachments?.map((a: any) => ({ id: a.id, filename: a.filename, size: a.size, createdAt: a.createdAt })),
  };
}

export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/support/tickets', async (req) => {
    const rows = await prisma.supportTicket.findMany({ where: { businessId: req.auth!.businessId! }, orderBy: { updatedAt: 'desc' }, take: 100 });
    return rows.map(ticketDto);
  });

  app.post('/support/tickets', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z
      .object({
        title: zTrim(200).min(4),
        description: zTrim(5000).min(10),
        category: z.enum(['COMPLAINT', 'MESSAGE', 'TECHNICAL']),
        queryType: z.enum(['INTEGRATION', 'POST_INTEGRATION']),
        priority: z.enum(['HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
      })
      .parse(req.body);
    const t = await prisma.supportTicket.create({ data: { ...body, businessId: req.auth!.businessId!, userId: req.auth!.user.id } });
    await audit(req, { action: 'support.create', entityType: 'SupportTicket', entityId: t.id });
    await notifyAdmins('SUPPORT_TICKET', `New ${body.priority.toLowerCase()} ticket #${t.number}`, body.title, `/admin/support/${t.id}`, req.auth!.businessId!);
    return reply.status(201).send(ticketDto(t));
  });

  async function own(req: any, id: string) {
    const t = await prisma.supportTicket.findFirst({ where: { id, businessId: req.auth!.businessId! }, include: { messages: { orderBy: { createdAt: 'asc' } }, attachments: { select: { id: true, filename: true, size: true, createdAt: true } } } });
    if (!t) throw notFound('Ticket');
    return t;
  }

  app.get('/support/tickets/:id', async (req) => ticketDto(await own(req, (req.params as { id: string }).id)));

  app.post('/support/tickets/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const t = await own(req, id);
    const { body } = z.object({ body: zTrim(5000).min(1) }).parse(req.body);
    await prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: req.auth!.user.id, body } });
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: t.status === 'AWAITING_USER' || t.status === 'RESOLVED' ? 'OPEN' : t.status } });
    await notifyAdmins('SUPPORT_REPLY', `Reply on ticket #${t.number}`, body.slice(0, 200), `/admin/support/${t.id}`, req.auth!.businessId!);
    return ticketDto(await own(req, id));
  });

  app.post('/support/tickets/:id/attachments', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    const t = await own(req, id);
    const { name, buf } = await readPdf(req);
    await prisma.ticketAttachment.create({ data: { ticketId: t.id, filename: name, mime: 'application/pdf', size: buf.length, sha256: sha256Hex(buf), data: buf, uploadedById: req.auth!.user.id } });
    await audit(req, { action: 'support.attach', entityType: 'SupportTicket', entityId: t.id, metadata: { filename: name, size: buf.length } });
    return ticketDto(await own(req, id));
  });

  app.get('/support/attachments/:id', async (req, reply) => {
    const a = await prisma.ticketAttachment.findFirst({ where: { id: (req.params as { id: string }).id, ticket: { businessId: req.auth!.businessId! } } });
    if (!a) throw notFound('Attachment');
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="${a.filename}"`).header('x-content-type-options', 'nosniff').send(Buffer.from(a.data));
  });

  app.post('/support/tickets/:id/close', async (req) => {
    const { id } = req.params as { id: string };
    const t = await own(req, id);
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    return ticketDto(await own(req, id));
  });
}
