/**
 * Imports the datasets extracted from the client-supplied documents (server/data/*.json):
 * scenario definitions + templates, applicability matrix, sales/purchase error codes and the
 * PCT/HS catalogue. Idempotent: reference tables are replaced in one transaction.
 * Fails loudly if any dataset is incomplete (never imports an illustrative subset).
 *
 *   npm run data:import            (development, tsx)
 *   npm run data:import:prod       (production, compiled)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db.js';
import { ERROR_GUIDANCE } from '../src/fbr/errorGuidance.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = [join(here, '..', 'data'), join(here, '..', '..', 'data')].find((p) => existsSync(join(p, 'scenarios.json')));
if (!DATA) throw new Error('server/data not found');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(DATA, f), 'utf8')) as T;

interface ScenarioFile { source: string; note: string; retailerOnly: string[]; purchaseType: string[]; scenarios: { scenarioId: string; description: string; saleTypeLabel: string }[] }
interface TemplateFile { source: string; templates: { label: string; title: string; scenarioId: string; raw: string; json: { items: { saleType: string }[] }; anomalies: string[] }[] }
interface ApplicabilityFile { source: string; rows: { sr: number; businessActivity: string; sector: string; scenarioIdsRaw: string[]; rawText: string; sourcePage: number }[]; rowNumberGaps: number[]; anomalies: { sr: number; type: string; detail: unknown }[] }
interface ErrorFile { source: string; entries: { code: string; category: string; messageDesc: string; briefMsgDesc: string; sourcePages: number[]; occurrences: number; variants: unknown[] }[]; counts: { SALES: number; PURCHASE: number } }
interface HsFile { sources: string[]; stats: Record<string, number>; records: { code: string; description: string; fullDescription: string; alternates: { description: string; line: number | string; source: string }[]; chapter: string; heading: string; sourceLines: number[]; source: string }[]; reconciliation: unknown }

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Import aborted: ${msg}`);
}

async function main() {
  const scen = load<ScenarioFile>('scenarios.json');
  const tpl = load<TemplateFile>('scenario_templates.json');
  const app = load<ApplicabilityFile>('applicability.json');
  const err = load<ErrorFile>('error_codes.json');
  const hs = load<HsFile>('hs_codes.json');
  const manifest = load<{ files: unknown[] }>('source_manifest.json');

  assert(scen.scenarios.length === 28, `expected 28 scenarios, found ${scen.scenarios.length}`);
  assert(tpl.templates.length === 28, `expected 28 templates, found ${tpl.templates.length}`);
  assert(app.rows.length === 104, `expected 104 applicability rows, found ${app.rows.length}`);
  assert(err.counts.SALES === 86 && err.counts.PURCHASE === 22, `unexpected error-code counts ${JSON.stringify(err.counts)}`);
  assert(hs.records.length === hs.stats.uniqueCodes, 'HS record count does not match extraction stats');

  const started = new Date();
  await prisma.$transaction(
    async (tx) => {
      await tx.scenarioDefinition.deleteMany();
      await tx.scenarioDefinition.createMany({
        data: scen.scenarios.map((s, i) => {
          const t = tpl.templates.find((x) => x.scenarioId === s.scenarioId);
          assert(t, `no template for ${s.scenarioId}`);
          return {
            id: s.scenarioId,
            description: s.description,
            saleTypeLabel: s.saleTypeLabel,
            saleTypeApi: t.json.items?.[0]?.saleType ?? s.saleTypeLabel,
            retailerOnly: scen.retailerOnly.includes(s.scenarioId),
            purchaseType: scen.purchaseType.includes(s.scenarioId),
            sortOrder: i + 1,
            source: scen.source,
          };
        }),
      });
      await tx.scenarioTemplate.deleteMany();
      await tx.scenarioTemplate.createMany({
        data: tpl.templates.map((t) => ({ scenarioId: t.scenarioId, label: t.label, title: t.title, rawText: t.raw, json: t.json as object, anomalies: t.anomalies, source: tpl.source })),
      });
      await tx.applicabilityRule.deleteMany();
      await tx.applicabilityRule.createMany({ data: app.rows.map((r) => ({ ...r, source: app.source })) });
      await tx.sourceAnomaly.deleteMany({ where: { dataset: 'applicability' } });
      await tx.sourceAnomaly.createMany({
        data: [
          ...app.anomalies.map((a) => ({ dataset: 'applicability', ref: `row:${a.sr}`, type: a.type, detail: a.detail as object })),
          { dataset: 'applicability', ref: 'matrix', type: 'ROW_NUMBER_GAPS', detail: app.rowNumberGaps },
        ],
      });
      await tx.errorCode.deleteMany();
      await tx.errorCode.createMany({
        data: err.entries.map((e) => ({
          category: e.category,
          code: e.code,
          messageDesc: e.messageDesc,
          briefMsgDesc: e.briefMsgDesc,
          friendly: e.briefMsgDesc,
          field: ERROR_GUIDANCE[e.code]?.field ?? null,
          action: ERROR_GUIDANCE[e.code]?.action ?? 'Review the FBR message and correct the invoice.',
          variants: e.variants as object,
          occurrences: e.occurrences,
          sourcePages: e.sourcePages,
          source: err.source,
        })),
      });
      await tx.hsCodeAlternate.deleteMany();
      await tx.hsCode.deleteMany();
      const run = await tx.dataImportRun.create({ data: { dataset: 'hs_codes', sourceFiles: hs.sources, stats: hs.stats, report: hs.reconciliation as object, startedAt: started } });
      for (let i = 0; i < hs.records.length; i += 1000) {
        const chunk = hs.records.slice(i, i + 1000);
        await tx.hsCode.createMany({ data: chunk.map((r) => ({ code: r.code, description: r.description, fullDescription: r.fullDescription, chapter: r.chapter, heading: r.heading, source: r.source, sourceLines: r.sourceLines, importRunId: run.id })) });
        const alts = chunk.flatMap((r) => r.alternates.map((a) => ({ code: r.code, description: a.description, source: a.source, sourceLine: String(a.line) })));
        if (alts.length) await tx.hsCodeAlternate.createMany({ data: alts });
      }
      await tx.dataImportRun.update({ where: { id: run.id }, data: { finishedAt: new Date() } });
      await tx.dataImportRun.create({ data: { dataset: 'fbr_reference_bundle', sourceFiles: manifest.files as object, stats: { scenarios: 28, templates: 28, applicabilityRows: app.rows.length, salesErrorCodes: err.counts.SALES, purchaseErrorCodes: err.counts.PURCHASE, hsCodes: hs.records.length }, report: {}, startedAt: started, finishedAt: new Date() } });
    },
    { timeout: 120_000 },
  );

  const counts = {
    scenarios: await prisma.scenarioDefinition.count(),
    templates: await prisma.scenarioTemplate.count(),
    applicabilityRows: await prisma.applicabilityRule.count(),
    errorCodes: await prisma.errorCode.count(),
    hsCodes: await prisma.hsCode.count(),
    hsAlternates: await prisma.hsCodeAlternate.count(),
  };
  console.log('Reference data imported:', counts);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
