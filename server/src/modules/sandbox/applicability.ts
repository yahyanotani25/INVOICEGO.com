/**
 * Scenario applicability engine (Spec v1.12 §9 note + §10 matrix).
 * - Uses the complete imported matrix (104 rows), never a hand-written subset.
 * - Multiple business natures: union of the rows for each nature with the selected sector.
 * - Duplicate IDs are de-duplicated; every contributing row is kept as provenance.
 * - SN026/SN027/SN028 apply only when registered as a retailer in the sales tax profile.
 * - An official IRIS assignment (entered by the user) takes precedence; differences are reported.
 */
export interface MatrixRow {
  sr: number;
  businessActivity: string;
  sector: string;
  scenarioIdsRaw: string[];
  sourcePage: number;
}

export interface Anomaly {
  ref: string;
  type: string;
  detail: unknown;
}

export const RETAILER_ONLY = ['SN026', 'SN027', 'SN028'];

export type ScenarioApplicability = 'REQUIRED' | 'CONDITIONAL_NOT_MET' | 'NOT_APPLICABLE';

export interface ApplicabilityResult {
  scenarios: Record<string, { status: ScenarioApplicability; reasons: string[]; rows: number[] }>;
  required: string[];
  computedRequired: string[];
  usedOfficial: boolean;
  officialDiff: { onlyOfficial: string[]; onlyComputed: string[] } | null;
  missingCombinations: string[];
  notes: string[];
}

export function computeApplicability(
  input: { activities: string[]; sector: string; retailerRegistered: boolean; officialIds?: string[] },
  matrix: MatrixRow[],
  allScenarioIds: string[],
  anomalies: Anomaly[] = [],
): ApplicabilityResult {
  const scenarios: ApplicabilityResult['scenarios'] = {};
  for (const id of allScenarioIds) scenarios[id] = { status: 'NOT_APPLICABLE', reasons: [], rows: [] };
  const missing: string[] = [];
  const notes: string[] = [];
  const computed = new Set<string>();

  for (const activity of input.activities) {
    const rows = matrix.filter((r) => r.businessActivity === activity && r.sector === input.sector);
    if (rows.length === 0) {
      missing.push(`${activity} + ${input.sector}`);
      continue;
    }
    for (const row of rows) {
      for (const id of new Set(row.scenarioIdsRaw)) {
        const s = (scenarios[id] ??= { status: 'NOT_APPLICABLE', reasons: [], rows: [] });
        s.rows.push(row.sr);
        s.reasons.push(`Matrix row ${row.sr}: ${row.businessActivity} + ${row.sector} (spec v1.12 §10, p.${row.sourcePage})`);
        if (RETAILER_ONLY.includes(id) && !input.retailerRegistered) {
          if (s.status !== 'REQUIRED') s.status = 'CONDITIONAL_NOT_MET';
        } else {
          s.status = 'REQUIRED';
          computed.add(id);
        }
      }
      for (const a of anomalies.filter((x) => x.ref === `row:${row.sr}`)) {
        notes.push(`Row ${row.sr} source note: ${a.type} ${typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail)}`);
      }
    }
  }
  for (const id of RETAILER_ONLY) {
    if (scenarios[id]?.status === 'CONDITIONAL_NOT_MET') {
      scenarios[id].reasons.push('Applies only if the business is registered as a retailer in its sales tax profile (spec §9 note).');
    }
  }

  const computedRequired = [...computed].sort();
  const official = [...new Set(input.officialIds ?? [])].sort();
  let required = computedRequired;
  let officialDiff: ApplicabilityResult['officialDiff'] = null;
  if (official.length) {
    required = official;
    officialDiff = {
      onlyOfficial: official.filter((x) => !computed.has(x)),
      onlyComputed: computedRequired.filter((x) => !official.includes(x)),
    };
    for (const id of official) {
      const s = (scenarios[id] ??= { status: 'NOT_APPLICABLE', reasons: [], rows: [] });
      s.status = 'REQUIRED';
      s.reasons.unshift('Listed in the official IRIS assignment recorded for this business');
    }
    for (const id of officialDiff.onlyComputed) {
      scenarios[id].status = 'NOT_APPLICABLE';
      scenarios[id].reasons.unshift('Not in the official IRIS assignment (the matrix suggests it — review)');
    }
  }
  return { scenarios, required, computedRequired, usedOfficial: official.length > 0, officialDiff, missingCombinations: missing, notes: [...new Set(notes)] };
}
