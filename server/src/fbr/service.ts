import type { AttemptOperation, AttemptOutcome, FbrEnvironment, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { decryptSecret, sha256Hex } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { DEFAULT_URLS, referenceUrl, validateInvoiceUrl, type ReferenceName } from './endpoints.js';
import { fbrHttp, type HttpResult } from './http.js';
import { classifyResponse, type Classified, type Operation } from './response.js';

export interface ResolvedCredential {
  environment: FbrEnvironment;
  postUrl: string;
  validateUrl: string;
  token: string;
}

export async function resolveCredential(businessId: string, env: FbrEnvironment): Promise<ResolvedCredential> {
  const c = await prisma.fbrCredential.findUnique({ where: { businessId_environment: { businessId, environment: env } } });
  if (!c?.tokenEnc) {
    throw new AppError(409, 'FBR_NOT_CONFIGURED', `${env === 'SANDBOX' ? 'Sandbox' : 'Production'} token is not configured. Add it under FBR integration.`);
  }
  return {
    environment: env,
    postUrl: validateInvoiceUrl(c.postUrl || DEFAULT_URLS[env].postUrl, env, 'post'),
    validateUrl: validateInvoiceUrl(c.validateUrl || DEFAULT_URLS[env].validateUrl, env, 'validate'),
    token: decryptSecret(c.tokenEnc),
  };
}

/** Token for reference / lookup APIs (same URL for both environments; routing by token — spec §4 note). */
export async function lookupToken(businessId: string): Promise<{ env: FbrEnvironment; token: string } | null> {
  const creds = await prisma.fbrCredential.findMany({ where: { businessId, tokenEnc: { not: null } } });
  const pick = creds.find((c) => c.environment === 'PRODUCTION' && c.status !== 'UNAUTHORIZED') ?? creds.find((c) => c.environment === 'SANDBOX' && c.status !== 'UNAUTHORIZED') ?? creds[0];
  if (!pick?.tokenEnc) return null;
  return { env: pick.environment, token: decryptSecret(pick.tokenEnc) };
}

const truncate = (s: string | undefined, n = 64 * 1024) => (s && s.length > n ? s.slice(0, n) + '…[truncated]' : s);

function outcomeFromHttp(r: HttpResult, op: AttemptOperation): AttemptOutcome {
  if (r.delivery === 'NOT_SENT') return 'NOT_SENT';
  if (r.delivery === 'UNCERTAIN') return op === 'POST' ? 'UNCERTAIN' : 'HTTP_ERROR';
  if (r.status === 401 || r.status === 403) return 'AUTH_ERROR';
  if (r.status! >= 200 && r.status! < 300) return 'OK';
  return 'HTTP_ERROR';
}

export interface InvoiceCallResult {
  attemptId: string;
  http: HttpResult;
  classified: Classified;
}

/**
 * Validate or post an invoice payload. The attempt row is written BEFORE the network call so
 * a crash mid-request leaves evidence (and the stale-lock sweeper flags the invoice).
 */
export async function callInvoiceApi(args: {
  businessId: string;
  invoiceId: string | null;
  op: Operation;
  env: FbrEnvironment;
  payloadText: string;
  itemCount: number;
  scenarioId?: string | null;
  initiatedById?: string | null;
  initiatedKind?: 'USER' | 'ADMIN' | 'SYSTEM';
  retryOfId?: string | null;
}): Promise<InvoiceCallResult> {
  const cred = await resolveCredential(args.businessId, args.env);
  const url = args.op === 'POST' ? cred.postUrl : cred.validateUrl;
  const attempt = await prisma.fbrAttempt.create({
    data: {
      businessId: args.businessId,
      invoiceId: args.invoiceId,
      environment: args.env,
      operation: args.op,
      url,
      requestBody: args.payloadText,
      requestHash: sha256Hex(args.payloadText),
      scenarioId: args.scenarioId ?? null,
      initiatedById: args.initiatedById ?? null,
      initiatedKind: args.initiatedKind ?? 'USER',
      retryOfId: args.retryOfId ?? null,
    },
  });
  const http = await fbrHttp({ method: 'POST', url, token: cred.token, body: args.payloadText });
  let classified: Classified;
  if (http.delivery === 'RESPONSE') {
    classified = classifyResponse(args.op, http.status!, http.body ?? '', args.itemCount);
  } else {
    classified = {
      outcome: http.delivery === 'NOT_SENT' ? 'NOT_SENT' : args.op === 'POST' ? 'UNCERTAIN' : 'HTTP_ERROR',
      invoiceNumber: null,
      dated: null,
      headerStatusCode: null,
      headerStatus: null,
      items: [],
      issues: [
        {
          scope: 'NETWORK',
          code: http.errorCode,
          message:
            http.delivery === 'NOT_SENT'
              ? `Could not reach FBR (${http.errorCode}). The request was not delivered.`
              : `Connection to FBR was interrupted or timed out (${http.errorCode}). FBR may or may not have recorded this request.`,
        },
      ],
      json: null,
    };
  }
  await prisma.fbrAttempt.update({
    where: { id: attempt.id },
    data: {
      httpStatus: http.status ?? null,
      responseBody: truncate(http.body),
      responseJson: (classified.json ?? undefined) as Prisma.InputJsonValue | undefined,
      outcome: classified.outcome as AttemptOutcome,
      fbrInvoiceNo: classified.invoiceNumber,
      errors: classified.issues as unknown as Prisma.InputJsonValue,
      errorMessage: http.errorMessage?.slice(0, 500) ?? null,
      durationMs: http.durationMs,
      finishedAt: new Date(),
    },
  });
  return { attemptId: attempt.id, http, classified };
}

/** Connection test: calls the Provinces reference API with the token. Never creates an invoice. */
export async function testConnection(businessId: string, env: FbrEnvironment, userId: string) {
  const cred = await resolveCredential(businessId, env);
  const url = referenceUrl('provinces');
  const attempt = await prisma.fbrAttempt.create({
    data: { businessId, environment: env, operation: 'CONNECTION_TEST', url, initiatedById: userId, initiatedKind: 'USER' },
  });
  const http = await fbrHttp({ method: 'GET', url, token: cred.token });
  const outcome = outcomeFromHttp(http, 'CONNECTION_TEST');
  const status = outcome === 'OK' ? 'OK' : outcome === 'AUTH_ERROR' ? 'UNAUTHORIZED' : 'ERROR';
  const message =
    outcome === 'OK'
      ? 'Token accepted by the FBR gateway (Provinces reference API returned HTTP 200). No invoice was created.'
      : outcome === 'AUTH_ERROR'
        ? `FBR rejected the token (HTTP ${http.status}). Check the token and your IP whitelisting.`
        : http.delivery !== 'RESPONSE'
          ? `Could not reach FBR (${http.errorCode}). Check network access and IP whitelisting.`
          : `Unexpected response from FBR (HTTP ${http.status}).`;
  await prisma.fbrAttempt.update({
    where: { id: attempt.id },
    data: { httpStatus: http.status, responseBody: truncate(http.body, 4000), outcome, durationMs: http.durationMs, finishedAt: new Date(), errorMessage: http.errorMessage },
  });
  await prisma.fbrCredential.update({
    where: { businessId_environment: { businessId, environment: env } },
    data: { status, lastCheckedAt: new Date(), lastCheckMessage: message, lastCheckHttpStatus: http.status ?? null },
  });
  return { status, message, httpStatus: http.status ?? null, checkedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- reference data
const REF_TTL_MS = 24 * 3600_000;

export async function fetchReference(businessId: string, name: ReferenceName, query: Record<string, string> = {}, opts: { refresh?: boolean; userId?: string } = {}) {
  const key = `${name}?${new URLSearchParams(Object.entries(query).sort()).toString()}`;
  const cached = await prisma.referenceCache.findUnique({ where: { key } });
  if (cached && !opts.refresh && Date.now() - cached.fetchedAt.getTime() < REF_TTL_MS) {
    return { data: cached.payload, fetchedAt: cached.fetchedAt, cached: true };
  }
  const tok = await lookupToken(businessId);
  if (!tok) {
    if (cached) return { data: cached.payload, fetchedAt: cached.fetchedAt, cached: true, stale: true };
    throw new AppError(409, 'FBR_NOT_CONFIGURED', 'Configure an FBR token to load reference data from FBR.');
  }
  const url = referenceUrl(name, query);
  const http = await fbrHttp({ method: 'GET', url, token: tok.token });
  await prisma.fbrAttempt.create({
    data: {
      businessId,
      environment: tok.env,
      operation: 'REFERENCE',
      url,
      httpStatus: http.status,
      outcome: outcomeFromHttp(http, 'REFERENCE'),
      responseBody: truncate(http.body, 2000),
      durationMs: http.durationMs,
      finishedAt: new Date(),
      initiatedById: opts.userId,
      errorMessage: http.errorMessage,
    },
  });
  if (http.delivery !== 'RESPONSE' || http.status !== 200) {
    if (cached) return { data: cached.payload, fetchedAt: cached.fetchedAt, cached: true, stale: true };
    throw new AppError(502, 'FBR_REFERENCE_FAILED', `FBR reference API ${name} failed (${http.status ?? http.errorCode})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(http.body ?? '');
  } catch {
    throw new AppError(502, 'FBR_REFERENCE_FAILED', `FBR reference API ${name} returned non-JSON`);
  }
  await prisma.referenceCache.upsert({
    where: { key },
    create: { key, payload: data as Prisma.InputJsonValue, httpStatus: 200, fetchedById: opts.userId },
    update: { payload: data as Prisma.InputJsonValue, httpStatus: 200, fetchedAt: new Date(), fetchedById: opts.userId },
  });
  return { data, fetchedAt: new Date(), cached: false };
}

// ---------------------------------------------------------------- registration type (spec §5.12)
export type RegLookup =
  | { result: 'REGISTERED' | 'UNREGISTERED'; statusCode: string | null; rawType: string | null; checkedAt: Date; id: string; cached: boolean }
  | { result: 'UNAVAILABLE'; message: string; checkedAt: Date; id: string | null; cached: boolean };

/**
 * Looks up the buyer's registration type. A timeout, network error, auth error or ambiguous
 * answer is UNAVAILABLE — never interpreted as "Unregistered".
 */
export async function lookupRegistrationType(businessId: string, registrationNo: string, userId?: string): Promise<RegLookup> {
  const regNo = registrationNo.trim();
  const recent = await prisma.buyerVerification.findFirst({
    where: { businessId, registrationNo: regNo, result: { in: ['REGISTERED', 'UNREGISTERED'] }, checkedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { checkedAt: 'desc' },
  });
  if (recent) {
    return { result: recent.result as 'REGISTERED' | 'UNREGISTERED', statusCode: recent.statusCode, rawType: recent.rawType, checkedAt: recent.checkedAt, id: recent.id, cached: true };
  }
  const tok = await lookupToken(businessId);
  if (!tok) {
    const v = await prisma.buyerVerification.create({ data: { businessId, registrationNo: regNo, result: 'UNAVAILABLE', message: 'No FBR token configured' } });
    return { result: 'UNAVAILABLE', message: 'Registration status could not be verified: no FBR token is configured.', checkedAt: v.checkedAt, id: v.id, cached: false };
  }
  const url = referenceUrl('Get_Reg_Type');
  const body = JSON.stringify({ Registration_No: regNo });
  const http = await fbrHttp({ method: config.FBR_LOOKUP_METHOD, url, token: tok.token, body });
  const attempt = await prisma.fbrAttempt.create({
    data: {
      businessId,
      environment: tok.env,
      operation: 'REG_TYPE_LOOKUP',
      url,
      requestBody: body,
      httpStatus: http.status,
      outcome: outcomeFromHttp(http, 'REG_TYPE_LOOKUP'),
      responseBody: truncate(http.body, 4000),
      durationMs: http.durationMs,
      finishedAt: new Date(),
      initiatedById: userId,
      errorMessage: http.errorMessage,
    },
  });
  let result: 'REGISTERED' | 'UNREGISTERED' | 'UNAVAILABLE' = 'UNAVAILABLE';
  let statusCode: string | null = null;
  let rawType: string | null = null;
  let message = '';
  if (http.delivery === 'RESPONSE' && http.status === 200) {
    try {
      const j = JSON.parse(http.body ?? '');
      statusCode = j.statuscode != null ? String(j.statuscode) : j['status code'] != null ? String(j['status code']) : null;
      rawType = j.REGISTRATION_TYPE != null ? String(j.REGISTRATION_TYPE) : null;
      const byType = rawType ? (/^registered$/i.test(rawType.trim()) ? 'REGISTERED' : /^unregistered$/i.test(rawType.trim()) ? 'UNREGISTERED' : null) : null;
      const byCode = statusCode === '00' ? 'REGISTERED' : statusCode === '01' ? 'UNREGISTERED' : null;
      if (byType && byCode && byType !== byCode) {
        message = `Ambiguous FBR answer (statuscode ${statusCode}, type ${rawType})`;
      } else if (byType || byCode) {
        result = (byType ?? byCode)!;
      } else {
        message = 'FBR response did not contain a recognisable registration type';
      }
    } catch {
      message = 'FBR returned an unreadable response';
    }
  } else if (http.delivery !== 'RESPONSE') {
    message = `FBR could not be reached (${http.errorCode})`;
  } else {
    message = `FBR returned HTTP ${http.status}`;
  }
  const v = await prisma.buyerVerification.create({
    data: { businessId, registrationNo: regNo, result, statusCode, rawType, httpStatus: http.status, message: message || null, attemptId: attempt.id },
  });
  if (result === 'UNAVAILABLE') {
    return { result, message: `Registration status could not be verified: ${message}.`, checkedAt: v.checkedAt, id: v.id, cached: false };
  }
  return { result, statusCode, rawType, checkedAt: v.checkedAt, id: v.id, cached: false };
}

export function mismatchMessage(buyerName: string, actual: 'REGISTERED' | 'UNREGISTERED') {
  const name = buyerName.trim() || 'Buyer';
  return actual === 'REGISTERED' ? `${name} is Registered. Please select Registered.` : `${name} is Unregistered. Please select Unregistered.`;
}
