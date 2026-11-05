import { prisma } from '../db.js';
import { ERROR_GUIDANCE, FIELD_LABELS } from './errorGuidance.js';
import type { FbrIssue } from './response.js';

export interface ExplainedIssue extends FbrIssue {
  known: boolean;
  category?: string;
  fbrMessage?: string;
  fbrDescription?: string;
  field?: string;
  fieldLabel?: string;
  action?: string;
}

/**
 * Attach the catalogued FBR message/description and InvoiceGO guidance to each issue.
 * Unknown codes keep their original FBR message (never replaced by a generic text).
 */
export async function explainIssues(issues: FbrIssue[]): Promise<ExplainedIssue[]> {
  const codes = [...new Set(issues.map((i) => i.code).filter((c): c is string => !!c && /^\d{4}$/.test(c)))];
  const rows = codes.length ? await prisma.errorCode.findMany({ where: { code: { in: codes } } }) : [];
  return issues.map((i) => {
    const row = i.code ? rows.find((r) => r.code === i.code && r.category === 'SALES') ?? rows.find((r) => r.code === i.code) : undefined;
    const g = i.code ? ERROR_GUIDANCE[i.code] : undefined;
    if (!row) {
      return {
        ...i,
        known: false,
        action:
          i.scope === 'HTTP' && i.code === '401'
            ? 'Check the FBR token for this environment, and that this server IP is whitelisted in IRIS.'
            : i.scope === 'NETWORK'
              ? 'Check connectivity to FBR. If the outcome is uncertain, reconcile before any reattempt.'
              : 'This message was returned by FBR and is not in the supplied error catalogue. Review the raw response.',
      };
    }
    return {
      ...i,
      known: true,
      category: row.category,
      fbrMessage: row.messageDesc,
      fbrDescription: row.briefMsgDesc,
      field: row.field ?? g?.field,
      fieldLabel: (row.field ?? g?.field) ? FIELD_LABELS[(row.field ?? g?.field)!] : undefined,
      action: row.action || g?.action,
    };
  });
}
