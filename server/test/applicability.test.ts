import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeApplicability, type MatrixRow } from '../src/modules/sandbox/applicability';

const data = JSON.parse(readFileSync(new URL('../data/applicability.json', import.meta.url), 'utf8')) as { rows: MatrixRow[]; anomalies: { sr: number; type: string; detail: unknown }[]; businessActivities: string[]; sectors: string[] };
const ALL = Array.from({ length: 28 }, (_, i) => `SN${String(i + 1).padStart(3, '0')}`);
const BASE = ['SN001', 'SN002', 'SN005', 'SN006', 'SN007', 'SN015', 'SN016', 'SN017', 'SN021', 'SN022', 'SN024'];
const anomalies = data.anomalies.map((a) => ({ ref: `row:${a.sr}`, type: a.type, detail: a.detail }));
const run = (activities: string[], sector: string, retailerRegistered = false, officialIds?: string[]) => computeApplicability({ activities, sector, retailerRegistered, officialIds }, data.rows, ALL, anomalies);

describe('applicability engine uses the complete supplied matrix (spec v1.12 §10)', () => {
  it('imports all 104 rows = 8 business activities x 13 sectors', () => {
    expect(data.rows).toHaveLength(104);
    expect(data.businessActivities.sort()).toEqual(['Distributor', 'Exporter', 'Importer', 'Manufacturer', 'Other', 'Retailer', 'Service Provider', 'Wholesaler']);
    expect(data.sectors).toHaveLength(13);
    for (const a of data.businessActivities) for (const s of data.sectors) expect(data.rows.filter((r) => r.businessActivity === a && r.sector === s)).toHaveLength(1);
  });

  it('Manufacturer + Steel = SN003, SN004, SN011', () => {
    expect(run(['Manufacturer'], 'Steel').required).toEqual(['SN003', 'SN004', 'SN011']);
  });

  it('Manufacturer + Textile = base manufacturer set + SN009', () => {
    expect(run(['Manufacturer'], 'Textile').required).toEqual([...BASE, 'SN009'].sort());
  });

  it('Service Provider + Services = SN018, SN019', () => {
    expect(run(['Service Provider'], 'Services').required).toEqual(['SN018', 'SN019']);
  });

  it('Retailer + FMCG: SN008 required; SN026-028 conditional unless registered as retailer', () => {
    const r = run(['Retailer'], 'FMCG');
    expect(r.required).toEqual(['SN008']);
    for (const id of ['SN026', 'SN027', 'SN028']) {
      expect(r.scenarios[id].status).toBe('CONDITIONAL_NOT_MET');
      expect(r.scenarios[id].reasons.join(' ')).toMatch(/retailer/i);
    }
    expect(run(['Retailer'], 'FMCG', true).required).toEqual(['SN008', 'SN026', 'SN027', 'SN028']);
  });

  it('Distributor + Petroleum (retailer registered) = SN012, SN026, SN027, SN028, SN008', () => {
    expect(run(['Distributor'], 'Petroleum', true).required).toEqual(['SN008', 'SN012', 'SN026', 'SN027', 'SN028']);
  });

  it('multiple business natures are combined and de-duplicated with provenance', () => {
    const r = run(['Manufacturer', 'Retailer'], 'FMCG');
    expect(r.required).toEqual([...BASE, 'SN008'].sort());
    expect(r.scenarios.SN008.rows.sort()).toEqual([3, 78]);
    expect(new Set(r.required).size).toBe(r.required.length);
  });

  it('the duplicated SN008 in row 33 is de-duplicated (and noted)', () => {
    const r = run(['Distributor'], 'FMCG', true);
    expect(r.required).toEqual(['SN008', 'SN026', 'SN027', 'SN028']);
    expect(r.scenarios.SN008.rows).toEqual([33]);
    expect(r.notes.join(' ')).toMatch(/DUPLICATE_SCENARIO_IN_ROW/);
  });

  it('documented exception kept: Manufacturer + Pharmaceuticals has no SN025, Importer + Pharmaceuticals does', () => {
    expect(run(['Manufacturer'], 'Pharmaceuticals').required).not.toContain('SN025');
    expect(run(['Importer'], 'Pharmaceuticals').required).toContain('SN025');
  });

  it('does not require all 28 scenarios', () => {
    expect(run(['Manufacturer'], 'All Other Sectors').required).toEqual([...BASE].sort());
  });

  it('an official IRIS assignment overrides the computed set and reports differences', () => {
    const r = run(['Manufacturer'], 'Steel', false, ['SN003', 'SN004', 'SN009']);
    expect(r.usedOfficial).toBe(true);
    expect(r.required).toEqual(['SN003', 'SN004', 'SN009']);
    expect(r.officialDiff).toEqual({ onlyOfficial: ['SN009'], onlyComputed: ['SN011'] });
    expect(r.scenarios.SN011.status).toBe('NOT_APPLICABLE');
  });
});
