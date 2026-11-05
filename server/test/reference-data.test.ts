import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';

describe('imported reference data (from the supplied documents)', () => {
  afterAll(() => prisma.$disconnect());

  it('contains every supplied record, not a subset', async () => {
    expect(await prisma.scenarioDefinition.count()).toBe(28);
    expect(await prisma.scenarioTemplate.count()).toBe(28);
    expect(await prisma.applicabilityRule.count()).toBe(104);
    expect(await prisma.errorCode.count({ where: { category: 'SALES' } })).toBe(86);
    expect(await prisma.errorCode.count({ where: { category: 'PURCHASE' } })).toBe(22);
    expect(await prisma.hsCode.count()).toBe(7494);
    expect(await prisma.hsCodeAlternate.count()).toBeGreaterThan(0);
  });

  it('preserves leading zeros and dotted formatting in codes', async () => {
    const hs = await prisma.hsCode.findUnique({ where: { code: '0101.2100' } });
    expect(hs?.description).toBe('- - Pure-bred breeding animals');
    const e = await prisma.errorCode.findUnique({ where: { category_code: { category: 'SALES', code: '0052' } } });
    expect(e?.messageDesc).toMatch(/valid HS Code/);
    const p = await prisma.errorCode.findUnique({ where: { category_code: { category: 'PURCHASE', code: '0157' } } });
    expect(p?.occurrences).toBe(3);
  });

  it('scenario definitions carry retailer/purchase flags and API sale types', async () => {
    const d = await prisma.scenarioDefinition.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(d.filter((x) => x.retailerOnly).map((x) => x.id)).toEqual(['SN026', 'SN027', 'SN028']);
    expect(d.find((x) => x.id === 'SN009')!.purchaseType).toBe(true);
    expect(d.find((x) => x.id === 'SN024')!.saleTypeApi).toBe('Goods as per SRO.297(I)/2023');
    const t = await prisma.scenarioTemplate.findUnique({ where: { scenarioId: 'SN010' } });
    expect(t!.label).toBe('SN0010');
    expect(t!.rawText).toContain('"scenarioId": "SN010"');
  });
});
