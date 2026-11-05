import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { listQuery, paging, sortBy } from '../../lib/listing.js';
import { ntnCnicProblem, zTrim } from '../../lib/validators.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';
import { lookupRegistrationType, mismatchMessage } from '../../fbr/service.js';

const customerSchema = z.object({
  name: zTrim(200).min(2),
  ntnCnic: zTrim(20).optional().nullable(),
  strn: zTrim(30).optional().nullable(),
  province: zTrim(100).min(2),
  address: zTrim(300).min(2),
  registrationType: z.enum(['REGISTERED', 'UNREGISTERED']),
  phone: zTrim(30).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal('')),
  category: zTrim(100).optional().nullable(),
  allowDuplicate: z.boolean().optional().default(false),
});

function dto(c: Prisma.CustomerGetPayload<object>) {
  return {
    id: c.id,
    name: c.name,
    ntnCnic: c.ntnCnic,
    strn: c.strn,
    province: c.province,
    address: c.address,
    registrationType: c.registrationType,
    phone: c.phone,
    email: c.email,
    category: c.category,
    verifiedResult: c.verifiedResult,
    verifiedAt: c.verifiedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function customerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/customers', async (req) => {
    const q = listQuery.extend({ type: z.enum(['REGISTERED', 'UNREGISTERED', '']).optional() }).parse(req.query);
    const where: Prisma.CustomerWhereInput = {
      businessId: req.auth!.businessId!,
      deletedAt: null,
      ...(q.type ? { registrationType: q.type } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { ntnCnic: { contains: q.q } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, rows, reg, unreg] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({ where, orderBy: sortBy(['name', 'createdAt', 'province', 'registrationType'] as const, q.sort, q.dir, 'createdAt'), ...paging(q.page, q.pageSize) }),
      prisma.customer.count({ where: { businessId: req.auth!.businessId!, deletedAt: null, registrationType: 'REGISTERED' } }),
      prisma.customer.count({ where: { businessId: req.auth!.businessId!, deletedAt: null, registrationType: 'UNREGISTERED' } }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows: rows.map(dto), summary: { registered: reg, unregistered: unreg } };
  });

  app.get('/customers/:id', async (req) => {
    const c = await prisma.customer.findFirst({ where: { id: (req.params as { id: string }).id, businessId: req.auth!.businessId!, deletedAt: null } });
    if (!c) throw notFound('Customer');
    return dto(c);
  });

  async function validate(businessId: string, body: z.infer<typeof customerSchema>, excludeId?: string) {
    const np = ntnCnicProblem(body.ntnCnic, body.registrationType === 'REGISTERED');
    if (np) throw badRequest(np, { issues: [{ field: 'ntnCnic', level: 'error', message: body.registrationType === 'REGISTERED' && !body.ntnCnic ? 'NTN/CNIC is required for registered buyers' : np }] });
    if (body.ntnCnic && !body.allowDuplicate) {
      const dup = await prisma.customer.findFirst({ where: { businessId, ntnCnic: body.ntnCnic, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
      if (dup) throw conflict(`Another customer (${dup.name}) already uses this NTN/CNIC. Tick "save anyway" to keep both.`, { issues: [{ field: 'ntnCnic', level: 'error', message: 'Duplicate NTN/CNIC' }] }, 'DUPLICATE_NTN');
    }
  }

  app.post('/customers', { preHandler: requireMember('master.write') }, async (req, reply) => {
    const body = customerSchema.parse(req.body);
    await validate(req.auth!.businessId!, body);
    const { allowDuplicate: _a, ...data } = body;
    const c = await prisma.customer.create({ data: { ...data, email: data.email || null, ntnCnic: data.ntnCnic || null, businessId: req.auth!.businessId! } });
    await audit(req, { action: 'customer.create', entityType: 'Customer', entityId: c.id });
    return reply.status(201).send(dto(c));
  });

  app.put('/customers/:id', { preHandler: requireMember('master.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = customerSchema.parse(req.body);
    const existing = await prisma.customer.findFirst({ where: { id, businessId: req.auth!.businessId!, deletedAt: null } });
    if (!existing) throw notFound('Customer');
    await validate(req.auth!.businessId!, body, id);
    const { allowDuplicate: _a, ...data } = body;
    const changedReg = (data.ntnCnic || null) !== existing.ntnCnic;
    // Accepted invoices keep their own buyer snapshot; editing a customer never changes them.
    const c = await prisma.customer.update({
      where: { id },
      data: { ...data, email: data.email || null, ntnCnic: data.ntnCnic || null, ...(changedReg ? { verifiedResult: 'NOT_CHECKED', verifiedAt: null } : {}) },
    });
    await audit(req, { action: 'customer.update', entityType: 'Customer', entityId: id });
    return dto(c);
  });

  app.delete('/customers/:id', { preHandler: requireMember('master.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const n = await prisma.customer.updateMany({ where: { id, businessId: req.auth!.businessId!, deletedAt: null }, data: { deletedAt: new Date() } });
    if (n.count === 0) throw notFound('Customer');
    await audit(req, { action: 'customer.delete', entityType: 'Customer', entityId: id });
    return { ok: true };
  });

  /** Verify registration type with FBR (Get_Reg_Type). A lookup failure is never treated as "Unregistered". */
  app.post('/customers/:id/verify', { preHandler: requireMember('master.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.customer.findFirst({ where: { id, businessId: req.auth!.businessId!, deletedAt: null } });
    if (!c) throw notFound('Customer');
    if (!c.ntnCnic) throw badRequest('Add an NTN/CNIC to verify registration');
    const r = await lookupRegistrationType(req.auth!.businessId!, c.ntnCnic, req.auth!.user.id);
    const updated = await prisma.customer.update({ where: { id }, data: { verifiedResult: r.result, verifiedAt: r.checkedAt } });
    const mismatch = r.result !== 'UNAVAILABLE' && r.result !== c.registrationType;
    return {
      customer: dto(updated),
      result: r.result,
      mismatch,
      message: r.result === 'UNAVAILABLE' ? r.message : mismatch ? mismatchMessage(c.name, r.result) : `${c.name} is ${r.result === 'REGISTERED' ? 'Registered' : 'Unregistered'} (verified with FBR).`,
    };
  });
}
