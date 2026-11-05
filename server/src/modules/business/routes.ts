import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { BUSINESS_ACTIVITIES, SECTORS, ntnCnicProblem, zTrim } from '../../lib/validators.js';
import { requireBusiness, requireMember } from '../../plugins/auth.js';

const profileSchema = z.object({
  name: zTrim(200).min(2),
  ntnCnic: zTrim(20),
  strn: zTrim(30).optional().nullable(),
  address: zTrim(300).min(3),
  province: zTrim(100).min(2),
  phone: zTrim(30).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal('')),
  businessActivities: z.array(z.enum(BUSINESS_ACTIVITIES)).min(1, 'Select at least one business nature'),
  sector: z.enum(SECTORS),
  retailerRegistered: z.boolean(),
  invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, 'Use 1–10 letters, digits or hyphens').optional(),
  furtherTaxHelperRate: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v)))
    .refine((v) => v === null || /^\d{1,2}(\.\d{1,4})?$/.test(v), 'Enter a percentage such as 4 or 3.5'),
});

const onboardingSchema = z.object({
  integratorChoice: z.enum(['PRAL', 'OTHER']).nullable().optional(),
  otherIntegratorName: zTrim(200).nullable().optional(),
  technicalContactName: zTrim(120).nullable().optional(),
  technicalContactMobile: zTrim(30).nullable().optional(),
  technicalContactEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  erpProvider: zTrim(200).nullable().optional(),
  softwareType: z.enum(['Cloud', 'On-Premises']).nullable().optional(),
  softwareVersion: zTrim(50).nullable().optional(),
  crmUserEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  hostingCompany: zTrim(200).nullable().optional(),
  hostingCountry: zTrim(100).nullable().optional(),
  whitelistIps: z.array(z.string().trim().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter IPv4 addresses')).max(3, 'IRIS accepts 1–3 IPs per entry (use the .xls upload in IRIS for more)').optional(),
  whitelistStatus: z.enum(['NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  whitelistNotes: zTrim(500).nullable().optional(),
  checklist: z.record(z.boolean()).optional(),
});

export function businessDto(b: Awaited<ReturnType<typeof prisma.business.findUniqueOrThrow>>) {
  return {
    id: b.id,
    name: b.name,
    ntnCnic: b.ntnCnic,
    strn: b.strn,
    address: b.address,
    province: b.province,
    phone: b.phone,
    email: b.email,
    businessActivities: b.businessActivities,
    sector: b.sector,
    retailerRegistered: b.retailerRegistered,
    officialScenarioIds: b.officialScenarioIds,
    hasLogo: !!b.logoData,
    productionEnabled: b.productionEnabled,
    productionEnabledAt: b.productionEnabledAt,
    invoicePrefix: b.invoicePrefix,
    furtherTaxHelperRate: b.furtherTaxHelperRate?.toString() ?? null,
    createdAt: b.createdAt,
  };
}

export async function businessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/business', async (req) => businessDto(await prisma.business.findUniqueOrThrow({ where: { id: req.auth!.businessId! } })));

  app.put('/business', { preHandler: requireMember('business.manage') }, async (req) => {
    const body = profileSchema.parse(req.body);
    const np = ntnCnicProblem(body.ntnCnic, true);
    if (np) throw badRequest(np, { issues: [{ field: 'ntnCnic', level: 'error', message: np }] });
    const b = await prisma.business.update({
      where: { id: req.auth!.businessId! },
      data: {
        ...body,
        email: body.email || null,
        strn: body.strn || null,
        invoicePrefix: body.invoicePrefix ?? undefined,
      },
    });
    await audit(req, { action: 'business.update', entityType: 'Business', entityId: b.id });
    return businessDto(b);
  });

  app.put('/business/official-scenarios', { preHandler: requireMember('business.manage') }, async (req) => {
    const { scenarioIds } = z.object({ scenarioIds: z.array(z.string().regex(/^SN\d{3}$/)).max(28) }).parse(req.body);
    const b = await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { officialScenarioIds: [...new Set(scenarioIds)].sort() } });
    await audit(req, { action: 'business.official_scenarios', entityType: 'Business', entityId: b.id, metadata: { scenarioIds } });
    return businessDto(b);
  });

  app.post('/business/logo', { preHandler: requireMember('business.manage') }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('Choose an image file');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw badRequest('Logo must be PNG, JPEG or WebP');
    const buf = await file.toBuffer();
    if (buf.length > 1024 * 1024) throw badRequest('Logo must be 1 MB or smaller');
    const sig = buf.subarray(0, 4).toString('hex');
    const ok = sig.startsWith('89504e47') || sig.startsWith('ffd8ff') || buf.subarray(8, 12).toString() === 'WEBP';
    if (!ok) throw badRequest('File content is not a supported image');
    await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { logoData: buf, logoMime: file.mimetype } });
    await audit(req, { action: 'business.logo', entityType: 'Business', entityId: req.auth!.businessId! });
    return { ok: true };
  });

  app.delete('/business/logo', { preHandler: requireMember('business.manage') }, async (req) => {
    await prisma.business.update({ where: { id: req.auth!.businessId! }, data: { logoData: null, logoMime: null } });
    return { ok: true };
  });

  app.get('/business/logo', async (req, reply) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth!.businessId! }, select: { logoData: true, logoMime: true } });
    if (!b.logoData) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No logo' } });
    return reply.type(b.logoMime ?? 'image/png').header('cache-control', 'private, max-age=300').send(Buffer.from(b.logoData));
  });

  app.get('/business/members', async (req) => {
    const rows = await prisma.membership.findMany({ where: { businessId: req.auth!.businessId! }, include: { user: true } });
    return rows.map((m) => ({ id: m.id, role: m.role, name: m.user.name, email: m.user.email, status: m.user.status }));
  });

  // ---- onboarding & IP whitelisting guidance (no IRIS/CRM passwords are collected)
  app.get('/onboarding', async (req) => {
    const ob = await prisma.onboardingProfile.findUnique({ where: { businessId: req.auth!.businessId! } });
    const creds = await prisma.fbrCredential.findMany({ where: { businessId: req.auth!.businessId! } });
    const scen = await prisma.scenarioProgress.count({ where: { businessId: req.auth!.businessId!, status: 'PASSED' } });
    return {
      profile: ob,
      server: {
        outboundIps: config.OUTBOUND_IPS.split(',').map((s) => s.trim()).filter(Boolean),
        hostingCompany: config.HOSTING_COMPANY,
        hostingCountry: config.HOSTING_COUNTRY,
      },
      derived: {
        sandboxTokenSaved: creds.some((c) => c.environment === 'SANDBOX' && !!c.tokenEnc),
        sandboxTokenOk: creds.some((c) => c.environment === 'SANDBOX' && c.status === 'OK'),
        productionTokenSaved: creds.some((c) => c.environment === 'PRODUCTION' && !!c.tokenEnc),
        productionTokenOk: creds.some((c) => c.environment === 'PRODUCTION' && c.status === 'OK'),
        scenariosPassed: scen,
      },
    };
  });

  app.put('/onboarding', { preHandler: requireMember('business.manage') }, async (req) => {
    const body = onboardingSchema.parse(req.body);
    const data = {
      ...body,
      technicalContactEmail: body.technicalContactEmail || null,
      crmUserEmail: body.crmUserEmail || null,
      ...(body.whitelistStatus ? { whitelistUpdatedAt: new Date() } : {}),
    };
    const ob = await prisma.onboardingProfile.upsert({
      where: { businessId: req.auth!.businessId! },
      create: { businessId: req.auth!.businessId!, ...data, whitelistIps: body.whitelistIps ?? [], checklist: body.checklist ?? {} },
      update: data,
    });
    await audit(req, { action: 'onboarding.update', entityType: 'OnboardingProfile', entityId: ob.businessId });
    return ob;
  });
}
