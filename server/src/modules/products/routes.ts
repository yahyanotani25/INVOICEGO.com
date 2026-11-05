import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { listQuery, paging, sortBy } from '../../lib/listing.js';
import { zDecimal, zOptDecimal, zTrim } from '../../lib/validators.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';

const productSchema = z.object({
  sku: zTrim(60).min(1),
  description: zTrim(500).min(2),
  hsCode: z.string().trim().regex(/^\d{4}\.\d{4}$/, 'HS code must look like 0101.2100'),
  uom: zTrim(100).min(1),
  saleType: zTrim(200).min(1),
  rate: zTrim(100).optional().nullable(),
  unitPrice: zDecimal.refine((v) => Number(v) >= 0, 'Price cannot be negative'),
  retailPrice: zOptDecimal,
  sroScheduleNo: zTrim(100).optional().nullable(),
  sroItemSerialNo: zTrim(100).optional().nullable(),
});

function dto(p: Prisma.ProductGetPayload<object>) {
  return {
    id: p.id,
    sku: p.sku,
    description: p.description,
    hsCode: p.hsCode,
    uom: p.uom,
    saleType: p.saleType,
    rate: p.rate,
    unitPrice: p.unitPrice.toString(),
    retailPrice: p.retailPrice?.toString() ?? null,
    sroScheduleNo: p.sroScheduleNo,
    sroItemSerialNo: p.sroItemSerialNo,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/products', async (req) => {
    const q = listQuery.parse(req.query);
    const where: Prisma.ProductWhereInput = {
      businessId: req.auth!.businessId!,
      deletedAt: null,
      ...(q.q ? { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }, { hsCode: { contains: q.q } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, orderBy: sortBy(['sku', 'description', 'hsCode', 'unitPrice', 'createdAt'] as const, q.sort, q.dir, 'createdAt'), ...paging(q.page, q.pageSize) }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows: rows.map(dto) };
  });

  app.get('/products/:id', async (req) => {
    const p = await prisma.product.findFirst({ where: { id: (req.params as { id: string }).id, businessId: req.auth!.businessId!, deletedAt: null } });
    if (!p) throw notFound('Product');
    return dto(p);
  });

  async function checkSku(businessId: string, sku: string, excludeId?: string) {
    const dup = await prisma.product.findFirst({ where: { businessId, sku, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
    if (dup) throw conflict(`SKU ${sku} is already used by "${dup.description}"`, { issues: [{ field: 'sku', level: 'error', message: 'SKU must be unique' }] }, 'DUPLICATE_SKU');
  }

  async function checkHs(hsCode: string) {
    const known = await prisma.hsCode.findUnique({ where: { code: hsCode } });
    return known ? null : `HS code ${hsCode} is not in the supplied PCT/HS catalogue — FBR may reject it`;
  }

  app.post('/products', { preHandler: requireMember('master.write') }, async (req, reply) => {
    const body = productSchema.parse(req.body);
    await checkSku(req.auth!.businessId!, body.sku);
    const p = await prisma.product.create({ data: { ...body, businessId: req.auth!.businessId! } });
    await audit(req, { action: 'product.create', entityType: 'Product', entityId: p.id });
    return reply.status(201).send({ ...dto(p), warning: await checkHs(body.hsCode) });
  });

  app.put('/products/:id', { preHandler: requireMember('master.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = productSchema.parse(req.body);
    const existing = await prisma.product.findFirst({ where: { id, businessId: req.auth!.businessId!, deletedAt: null } });
    if (!existing) throw notFound('Product');
    await checkSku(req.auth!.businessId!, body.sku, id);
    const p = await prisma.product.update({ where: { id }, data: body });
    await audit(req, { action: 'product.update', entityType: 'Product', entityId: id });
    return { ...dto(p), warning: await checkHs(body.hsCode) };
  });

  app.delete('/products/:id', { preHandler: requireMember('master.write') }, async (req) => {
    const { id } = req.params as { id: string };
    const n = await prisma.product.updateMany({ where: { id, businessId: req.auth!.businessId!, deletedAt: null }, data: { deletedAt: new Date() } });
    if (n.count === 0) throw notFound('Product');
    await audit(req, { action: 'product.delete', entityType: 'Product', entityId: id });
    return { ok: true };
  });

  app.post('/products/check-hs', async (req) => {
    const { hsCode } = z.object({ hsCode: z.string() }).parse(req.body);
    if (!/^\d{4}\.\d{4}$/.test(hsCode.trim())) throw badRequest('Format must be 0000.0000');
    return { known: !(await checkHs(hsCode.trim())) };
  });
}
