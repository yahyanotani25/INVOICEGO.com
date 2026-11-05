import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { paging } from '../../lib/listing.js';
import { BUSINESS_ACTIVITIES, FALLBACK_PROVINCES, PAYMENT_MODES, SECTORS } from '../../lib/validators.js';
import { requireBusiness } from '../../plugins/auth.js';
import { fetchReference } from '../../fbr/service.js';
import { REFERENCE_PATHS, type ReferenceName } from '../../fbr/endpoints.js';
import { karachiNow, toDdMmmYyyy } from '../../lib/time.js';

/** Normalise a code query: "0101" -> "0101", "01012100" -> "0101.2100", "0101.21" -> "0101.21" */
export function codePrefix(q: string): string | null {
  const s = q.trim();
  if (/^\d{1,4}$/.test(s)) return s;
  if (/^\d{4}\.\d{0,4}$/.test(s)) return s;
  if (/^\d{5,8}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4)}`;
  return null;
}

const REF_QUERY: Partial<Record<ReferenceName, (q: Record<string, string>) => Record<string, string>>> = {
  SaleTypeToRate: (q) => ({ date: q.date ? toDdMmmYyyy(q.date) : toDdMmmYyyy(karachiNow().date), transTypeId: q.transTypeId ?? '', originationSupplier: q.originationSupplier ?? '' }),
  HS_UOM: (q) => ({ hs_code: q.hs_code ?? '', annexure_id: q.annexure_id ?? '3' }),
  SroSchedule: (q) => ({ rate_id: q.rate_id ?? '', date: q.date ? toDdMmmYyyy(q.date) : toDdMmmYyyy(karachiNow().date), origination_supplier_csv: q.origination_supplier_csv ?? '' }),
  SROItem: (q) => ({ date: q.date ?? karachiNow().date, sro_id: q.sro_id ?? '' }),
};

export async function catalogueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireBusiness);

  app.get('/hs-codes', async (req) => {
    const q = z.object({ q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const prefix = codePrefix(q.q);
    const where: Prisma.HsCodeWhereInput = !q.q
      ? {}
      : prefix
        ? { code: { startsWith: prefix } }
        : { OR: [{ description: { contains: q.q, mode: 'insensitive' } }, { fullDescription: { contains: q.q, mode: 'insensitive' } }, { alternates: { some: { description: { contains: q.q, mode: 'insensitive' } } } }] };
    const [total, rows] = await Promise.all([
      prisma.hsCode.count({ where }),
      prisma.hsCode.findMany({ where, orderBy: { code: 'asc' }, include: { alternates: true }, ...paging(q.page, q.pageSize) }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      matchedBy: !q.q ? 'all' : prefix ? 'code' : 'description',
      rows: rows.map((r) => ({
        code: r.code,
        description: r.description,
        fullDescription: r.fullDescription,
        chapter: r.chapter,
        source: r.source,
        sourceLines: r.sourceLines,
        alternates: r.alternates.map((a) => ({ description: a.description, source: a.source, line: a.sourceLine })),
      })),
    };
  });

  app.get('/hs-codes/import-report', async () => {
    const run = await prisma.dataImportRun.findFirst({ where: { dataset: 'hs_codes' }, orderBy: { startedAt: 'desc' } });
    if (!run) throw notFound('Import run');
    return { stats: run.stats, report: run.report, sourceFiles: run.sourceFiles, importedAt: run.finishedAt };
  });

  app.get('/hs-codes/:code', async (req) => {
    const r = await prisma.hsCode.findUnique({ where: { code: (req.params as { code: string }).code }, include: { alternates: true } });
    if (!r) throw notFound('HS code');
    return r;
  });

  app.get('/error-codes', async (req) => {
    const q = z.object({ q: z.string().trim().max(100).default(''), category: z.enum(['SALES', 'PURCHASE', '']).default('') }).parse(req.query);
    return prisma.errorCode.findMany({
      where: {
        ...(q.category ? { category: q.category } : {}),
        ...(q.q ? { OR: [{ code: { contains: q.q } }, { messageDesc: { contains: q.q, mode: 'insensitive' } }, { briefMsgDesc: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ category: 'desc' }, { code: 'asc' }],
    });
  });

  /** FBR reference APIs (§5) via the backend with caching. Tokens never leave the server. */
  app.get('/reference/:name', async (req) => {
    const { name } = req.params as { name: string };
    if (!(name in REFERENCE_PATHS) || name === 'statl' || name === 'Get_Reg_Type') throw badRequest('Unknown reference API');
    const raw = z.record(z.string().max(100)).parse(req.query ?? {});
    const { refresh, ...rest } = raw;
    const builder = REF_QUERY[name as ReferenceName];
    const query = builder ? builder(rest) : {};
    return fetchReference(req.auth!.businessId!, name as ReferenceName, query, { refresh: refresh === '1', userId: req.auth!.user.id });
  });

  /**
   * Lookup lists for forms. FBR reference data is used when it has been fetched (cached);
   * otherwise values seen in the supplied documents are offered and labelled as such.
   */
  app.get('/lookups', async () => {
    const templates = await prisma.scenarioTemplate.findMany();
    const items = templates.flatMap((t) => ((t.json as { items?: Record<string, unknown>[] }).items ?? []));
    const uniq = (xs: unknown[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))].sort();
    const cache = await prisma.referenceCache.findMany({ where: { key: { in: ['provinces?', 'uom?', 'transtypecode?', 'doctypecode?'] } } });
    const get = (k: string) => cache.find((c) => c.key === k);
    const provincesApi = get('provinces?')?.payload as { stateProvinceDesc?: string }[] | undefined;
    const uomApi = get('uom?')?.payload as { description?: string }[] | undefined;
    const transApi = get('transtypecode?')?.payload as { transactioN_DESC?: string; transactioN_TYPE_ID?: number }[] | undefined;
    return {
      provinces: provincesApi?.length
        ? { source: 'FBR provinces API', fetchedAt: get('provinces?')!.fetchedAt, values: uniq(provincesApi.map((p) => p.stateProvinceDesc)) }
        : { source: 'Fallback list (not from FBR) — refresh from the FBR Provinces API', values: FALLBACK_PROVINCES },
      uoms: uomApi?.length
        ? { source: 'FBR UOM API', fetchedAt: get('uom?')!.fetchedAt, values: uniq(uomApi.map((u) => u.description)) }
        : { source: 'Values found in the supplied scenario data — refresh from the FBR UOM API', values: uniq(items.map((i) => i.uoM)) },
      saleTypes: transApi?.length
        ? { source: 'FBR transaction types API', fetchedAt: get('transtypecode?')!.fetchedAt, values: uniq(transApi.map((t) => t.transactioN_DESC)), withIds: transApi }
        : { source: 'Values found in the supplied scenario data — refresh from the FBR transaction types API', values: uniq(items.map((i) => i.saleType)) },
      rates: { source: 'Values found in the supplied scenario data; use SaleTypeToRate for official rates', values: uniq(items.map((i) => i.rate)) },
      sroSchedules: { source: 'Values found in the supplied scenario data', values: uniq(items.map((i) => i.sroScheduleNo)) },
      invoiceTypes: [
        { value: 'SALE_INVOICE', label: 'Sale Invoice' },
        { value: 'DEBIT_NOTE', label: 'Debit Note' },
      ],
      paymentModes: PAYMENT_MODES,
      businessActivities: BUSINESS_ACTIVITIES,
      sectors: SECTORS,
      today: karachiNow(),
    };
  });
}
