import { Decimal } from 'decimal.js';
import type { Business, FbrEnvironment, Invoice, InvoiceItem, InvoiceSource, InvoiceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { checkInvoiceMonth, dateOnlyToIso, isoToDateOnly, karachiNow, MONTH_RULE_MESSAGE } from '../../lib/time.js';
import { ntnCnicProblem } from '../../lib/validators.js';
import { computeItem, D, discrepancies, invoiceTotals, money, qty4, type CalcIssue } from '../../fbr/calc.js';
import { buildPayload, payloadHash, serializePayload, type PayloadInvoice } from '../../fbr/payload.js';
import { callInvoiceApi, lookupRegistrationType, mismatchMessage, resolveCredential } from '../../fbr/service.js';
import { explainIssues, type ExplainedIssue } from '../../fbr/explain.js';
import { notifyAdmins, notifyBusiness } from '../notifications/notify.js';
import type { InvoiceInput, ItemInputParsed } from './schema.js';

export interface Ctx {
  businessId: string;
  userId: string;
  kind?: 'USER' | 'ADMIN' | 'SYSTEM';
}

export interface Issue {
  field: string;
  line?: number; // 1-based item line
  level: 'error' | 'warning';
  message: string;
  code?: string;
}

export const EDITABLE: InvoiceStatus[] = ['DRAFT', 'VALIDATED', 'VALIDATION_FAILED', 'REJECTED'];
const HS_RE = /^\d{4}\.\d{4}$/;
const DEBIT_REF_RE = /^(\d{7}|\d{13})DI\d{13}$/;

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

// ------------------------------------------------------------------ item preparation
interface ItemRow {
  lineNo: number;
  productId: string | null;
  saleType: string;
  hsCode: string;
  productDescription: string;
  rate: string;
  uom: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  valueSalesExcludingST: string;
  salesTaxApplicable: string;
  retailPricePerUnit: string | null;
  fixedNotifiedValueOrRetailPrice: string;
  extraTax: string;
  extraTaxEmpty: boolean;
  furtherTax: string;
  fedPayable: string;
  salesTaxWithheldAtSource: string;
  sroScheduleNo: string;
  sroItemSerialNo: string;
  totalValues: string;
}

export function prepareItems(items: ItemInputParsed[], autoCalc: boolean): { rows: ItemRow[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const rows = items.map((it, idx) => {
    const line = idx + 1;
    const push = (list: CalcIssue[]) => list.forEach((c) => issues.push({ field: c.field, line, level: c.level, message: c.message }));
    const common = {
      lineNo: line,
      productId: it.productId ?? null,
      saleType: it.saleType,
      hsCode: it.hsCode,
      productDescription: it.productDescription,
      rate: it.rate,
      uom: it.uom,
      extraTaxEmpty: !!it.extraTaxEmpty,
      sroScheduleNo: it.sroScheduleNo ?? '',
      sroItemSerialNo: it.sroItemSerialNo ?? '',
      retailPricePerUnit: it.retailPricePerUnit ?? null,
    };
    if (autoCalc) {
      const { values, issues: ci } = computeItem({ ...it, quantity: it.quantity ?? 0, unitPrice: it.unitPrice ?? 0 });
      push(ci);
      return {
        ...common,
        quantity: values.quantity.toFixed(4),
        unitPrice: values.unitPrice.toFixed(4),
        discount: values.discount.toFixed(2),
        valueSalesExcludingST: values.valueSalesExcludingST.toFixed(2),
        salesTaxApplicable: values.salesTaxApplicable.toFixed(2),
        fixedNotifiedValueOrRetailPrice: values.fixedNotifiedValueOrRetailPrice.toFixed(2),
        extraTax: values.extraTax.toFixed(2),
        furtherTax: values.furtherTax.toFixed(2),
        fedPayable: values.fedPayable.toFixed(2),
        salesTaxWithheldAtSource: values.salesTaxWithheldAtSource.toFixed(2),
        totalValues: values.totalValues.toFixed(2),
      };
    }
    // Manual mode: keep entered values exactly (e.g. supplied scenario templates); report differences.
    push(discrepancies({ ...it, quantity: it.quantity ?? 0, unitPrice: it.unitPrice ?? 0 }));
    for (const f of ['quantity', 'valueSalesExcludingST', 'salesTaxApplicable', 'discount', 'furtherTax', 'extraTax', 'fedPayable', 'salesTaxWithheldAtSource', 'fixedNotifiedValueOrRetailPrice', 'totalValues'] as const) {
      if (it[f] !== null && D(it[f]).lt(0)) issues.push({ field: f, line, level: 'error', message: 'Amount cannot be negative' });
    }
    return {
      ...common,
      quantity: qty4(D(it.quantity)).toFixed(4),
      unitPrice: D(it.unitPrice).toFixed(4),
      discount: money(D(it.discount)).toFixed(2),
      valueSalesExcludingST: money(D(it.valueSalesExcludingST)).toFixed(2),
      salesTaxApplicable: money(D(it.salesTaxApplicable)).toFixed(2),
      fixedNotifiedValueOrRetailPrice: money(D(it.fixedNotifiedValueOrRetailPrice)).toFixed(2),
      extraTax: money(D(it.extraTax)).toFixed(2),
      furtherTax: money(D(it.furtherTax)).toFixed(2),
      fedPayable: money(D(it.fedPayable)).toFixed(2),
      salesTaxWithheldAtSource: money(D(it.salesTaxWithheldAtSource)).toFixed(2),
      totalValues: money(D(it.totalValues)).toFixed(2),
    };
  });
  return { rows, issues };
}

// ------------------------------------------------------------------ payload
export function toPayloadInvoice(inv: Pick<Invoice, 'invoiceType' | 'invoiceDate' | 'sellerNtnCnic' | 'sellerBusinessName' | 'sellerProvince' | 'sellerAddress' | 'buyerNtnCnic' | 'buyerBusinessName' | 'buyerProvince' | 'buyerAddress' | 'buyerRegistrationType' | 'invoiceRefNo' | 'scenarioId'>, items: (InvoiceItem | ItemRow)[]): PayloadInvoice {
  return {
    invoiceType: inv.invoiceType,
    invoiceDate: inv.invoiceDate instanceof Date ? dateOnlyToIso(inv.invoiceDate) : String(inv.invoiceDate),
    sellerNtnCnic: inv.sellerNtnCnic,
    sellerBusinessName: inv.sellerBusinessName,
    sellerProvince: inv.sellerProvince,
    sellerAddress: inv.sellerAddress,
    buyerNtnCnic: inv.buyerNtnCnic,
    buyerBusinessName: inv.buyerBusinessName,
    buyerProvince: inv.buyerProvince,
    buyerAddress: inv.buyerAddress,
    buyerRegistrationType: inv.buyerRegistrationType,
    invoiceRefNo: inv.invoiceRefNo,
    scenarioId: inv.scenarioId,
    items: [...items]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((it) => ({
        hsCode: it.hsCode,
        productDescription: it.productDescription,
        rate: it.rate,
        uom: it.uom,
        quantity: String(it.quantity),
        totalValues: String(it.totalValues),
        valueSalesExcludingST: String(it.valueSalesExcludingST),
        fixedNotifiedValueOrRetailPrice: String(it.fixedNotifiedValueOrRetailPrice),
        salesTaxApplicable: String(it.salesTaxApplicable),
        salesTaxWithheldAtSource: String(it.salesTaxWithheldAtSource),
        extraTax: String(it.extraTax),
        extraTaxEmpty: it.extraTaxEmpty,
        furtherTax: String(it.furtherTax),
        sroScheduleNo: it.sroScheduleNo,
        fedPayable: String(it.fedPayable),
        discount: String(it.discount),
        saleType: it.saleType,
        sroItemSerialNo: it.sroItemSerialNo,
      })),
  };
}

export function payloadTextFor(inv: InvoiceWithItems) {
  return serializePayload(buildPayload(toPayloadInvoice(inv, inv.items), inv.environment));
}

// ------------------------------------------------------------------ local validation
export function localValidate(p: PayloadInvoice, env: FbrEnvironment, opts: { autoCalc: boolean }): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, message: string, line?: number, code?: string) => out.push({ field, message, line, level: 'error', code });
  const warn = (field: string, message: string, line?: number) => out.push({ field, message, line, level: 'warning' });

  const m = checkInvoiceMonth(p.invoiceDate);
  if (!m.ok) err('invoiceDate', m.message, undefined, 'MONTH_RULE');
  const sp = ntnCnicProblem(p.sellerNtnCnic, true);
  if (sp) err('sellerNtnCnic', `Seller ${sp} — update your business profile`);
  if (!p.sellerBusinessName.trim()) err('sellerBusinessName', 'Seller business name is missing in the business profile');
  if (!p.sellerProvince.trim()) err('sellerProvince', 'Seller province is missing in the business profile');
  if (!p.sellerAddress.trim()) err('sellerAddress', 'Seller address is missing in the business profile');
  if (!p.buyerBusinessName.trim()) err('buyerBusinessName', 'Buyer name is required');
  if (!p.buyerProvince.trim()) err('buyerProvince', 'Buyer province is required');
  if (!p.buyerAddress.trim()) err('buyerAddress', 'Buyer address is required');
  if (!p.buyerRegistrationType) err('buyerRegistrationType', 'Select the buyer type: Registered or Unregistered');
  const bp = ntnCnicProblem(p.buyerNtnCnic, p.buyerRegistrationType === 'REGISTERED');
  if (bp) err('buyerNtnCnic', p.buyerRegistrationType === 'REGISTERED' && !p.buyerNtnCnic.trim() ? 'Buyer NTN/CNIC is required for registered buyers' : `Buyer ${bp}`);
  if (/^\d{9}$/.test(p.buyerNtnCnic.trim())) warn('buyerNtnCnic', '9-digit NTN: FBR documentation is inconsistent about 9-digit numbers (see error 0002 vs 0402)');
  if (p.buyerNtnCnic.trim() && p.buyerNtnCnic.trim() === p.sellerNtnCnic.trim()) err('buyerNtnCnic', 'Buyer and seller registration numbers are the same — self-invoicing is not allowed (FBR 0058)');
  if (p.invoiceType === 'DEBIT_NOTE') {
    if (!p.invoiceRefNo.trim()) err('invoiceRefNo', 'A debit note requires the original FBR invoice number as reference');
    else if (!DEBIT_REF_RE.test(p.invoiceRefNo.trim())) err('invoiceRefNo', 'Reference must be an FBR invoice number: 22 characters for NTN (e.g. 7327556DI1744111990654) or 28 for CNIC');
  } else if (p.invoiceRefNo.trim()) {
    warn('invoiceRefNo', 'A reference invoice number is only required for debit notes');
  }
  if (env === 'SANDBOX' && !p.scenarioId) err('scenarioId', 'Select the sandbox scenario (scenarioId is required for sandbox requests)');
  if (p.items.length === 0) err('items', 'Add at least one item');
  p.items.forEach((it, i) => {
    const line = i + 1;
    if (!it.saleType.trim()) err('saleType', 'Sale type is required', line);
    if (!it.hsCode.trim()) err('hsCode', 'HS code is required', line);
    else if (!HS_RE.test(it.hsCode.trim())) err('hsCode', 'HS code must be in the format 0000.0000', line);
    if (!it.productDescription.trim()) (opts.autoCalc ? err : warn)('productDescription', 'Product description is required', line);
    if (!it.rate.trim()) err('rate', 'Tax rate is required', line);
    if (!it.uom.trim()) err('uom', 'UOM is required', line);
    if (D(it.quantity).lte(0)) (opts.autoCalc ? err : warn)('quantity', 'Quantity should be greater than zero', line);
  });
  return out;
}

// ------------------------------------------------------------------ helpers
async function loadBusiness(businessId: string) {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b) throw notFound('Business');
  return b;
}

export async function getInvoice(ctx: Ctx, id: string) {
  const inv = await prisma.invoice.findFirst({ where: { id, businessId: ctx.businessId }, include: { items: { orderBy: { lineNo: 'asc' } } } });
  if (!inv) throw notFound('Invoice');
  return inv;
}

function sellerSnapshot(b: Business) {
  return { sellerNtnCnic: b.ntnCnic, sellerBusinessName: b.name, sellerProvince: b.province, sellerAddress: b.address };
}

function monthGuard(dateIso: string) {
  const m = checkInvoiceMonth(dateIso);
  if (!m.ok) throw new AppError(422, m.reason === 'OUTSIDE_CURRENT_MONTH' ? 'MONTH_RULE' : 'INVALID_DATE', m.message, { field: 'invoiceDate' });
}

async function allocateNumber(tx: Prisma.TransactionClient, businessId: string, env: FbrEnvironment, dateIso: string) {
  const b = await tx.business.update({ where: { id: businessId }, data: { nextInvoiceSeq: { increment: 1 } } });
  const seq = b.nextInvoiceSeq - 1;
  const prefix = env === 'SANDBOX' ? 'SBX' : b.invoicePrefix;
  return `${prefix}-${dateIso.slice(0, 4)}-${String(seq).padStart(6, '0')}`;
}

async function assertCustomer(ctx: Ctx, customerId?: string | null) {
  if (!customerId) return null;
  const c = await prisma.customer.findFirst({ where: { id: customerId, businessId: ctx.businessId } });
  if (!c) throw notFound('Customer');
  return c.id;
}

function headerData(input: InvoiceInput) {
  return {
    invoiceType: input.invoiceType,
    invoiceDate: isoToDateOnly(input.invoiceDate),
    invoiceTime: input.invoiceTime ?? karachiNow().time,
    paymentMode: input.paymentMode ?? null,
    invoiceRefNo: input.invoiceRefNo ?? '',
    buyerNtnCnic: input.buyerNtnCnic ?? '',
    buyerBusinessName: input.buyerBusinessName,
    buyerProvince: input.buyerProvince,
    buyerAddress: input.buyerAddress,
    buyerRegistrationType: input.buyerRegistrationType,
    autoCalc: input.autoCalc,
    notes: input.notes ?? null,
  };
}

function totalsData(rows: ItemRow[]) {
  const t = invoiceTotals(rows);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toFixed(2)]));
}

// ------------------------------------------------------------------ create / update
export async function createInvoice(
  ctx: Ctx,
  input: InvoiceInput,
  opts: { environment: FbrEnvironment; source?: InvoiceSource; importJobId?: string; importRef?: string; rawTemplateDiff?: unknown },
) {
  const business = await loadBusiness(ctx.businessId);
  if (opts.environment === 'PRODUCTION' && !business.productionEnabled) {
    throw conflict('Production submission is not enabled for this business. Configure and verify the production token first.', undefined, 'PRODUCTION_DISABLED');
  }
  monthGuard(input.invoiceDate);
  const customerId = await assertCustomer(ctx, input.customerId);
  const { rows, issues } = prepareItems(input.items, input.autoCalc);
  const scenarioId = opts.environment === 'SANDBOX' ? input.scenarioId ?? null : null;
  const header = { ...headerData(input), ...sellerSnapshot(business), scenarioId, customerId };
  const hash = payloadHash(serializePayload(buildPayload(toPayloadInvoice(header, rows), opts.environment)));

  const created = await prisma.$transaction(async (tx) => {
    const internalNumber = await allocateNumber(tx, ctx.businessId, opts.environment, input.invoiceDate);
    return tx.invoice.create({
      data: {
        ...header,
        ...totalsData(rows),
        businessId: ctx.businessId,
        environment: opts.environment,
        internalNumber,
        source: opts.source ?? 'MANUAL',
        importJobId: opts.importJobId,
        importRef: opts.importRef,
        rawTemplateDiff: (opts.rawTemplateDiff ?? undefined) as Prisma.InputJsonValue | undefined,
        payloadHash: hash,
        createdById: ctx.userId,
        items: { create: rows },
      },
      include: { items: { orderBy: { lineNo: 'asc' } } },
    });
  });
  return { invoice: created, issues: [...issues, ...localValidate(toPayloadInvoice(created, created.items), created.environment, { autoCalc: created.autoCalc })] };
}

export async function updateInvoice(ctx: Ctx, id: string, input: InvoiceInput & { version?: number }) {
  const existing = await getInvoice(ctx, id);
  if (!EDITABLE.includes(existing.status)) {
    throw conflict(`An invoice in status ${existing.status} cannot be edited`, undefined, 'NOT_EDITABLE');
  }
  if (input.version !== undefined && input.version !== existing.version) {
    throw conflict('This invoice was changed by someone else. Reload and try again.', undefined, 'STALE_VERSION');
  }
  monthGuard(input.invoiceDate);
  const business = await loadBusiness(ctx.businessId);
  const customerId = await assertCustomer(ctx, input.customerId);
  const { rows, issues } = prepareItems(input.items, input.autoCalc);
  const scenarioId = existing.environment === 'SANDBOX' ? input.scenarioId ?? existing.scenarioId : null;
  const header = { ...headerData(input), ...sellerSnapshot(business), scenarioId, customerId };
  const hash = payloadHash(serializePayload(buildPayload(toPayloadInvoice(header, rows), existing.environment)));
  const stillValidated = existing.validatedHash === hash && existing.status === 'VALIDATED';

  const updated = await prisma.$transaction(async (tx) => {
    const n = await tx.invoice.updateMany({
      where: { id, businessId: ctx.businessId, version: existing.version, status: { in: EDITABLE } },
      data: {
        ...header,
        ...totalsData(rows),
        payloadHash: hash,
        // Any payload change invalidates the previous validation.
        status: stillValidated ? 'VALIDATED' : 'DRAFT',
        validatedHash: stillValidated ? existing.validatedHash : null,
        version: { increment: 1 },
      },
    });
    if (n.count !== 1) throw conflict('This invoice changed while saving. Reload and try again.', undefined, 'STALE_VERSION');
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceItem.createMany({ data: rows.map((r) => ({ ...r, invoiceId: id })) });
    return tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } } } });
  });
  return { invoice: updated, issues: [...issues, ...localValidate(toPayloadInvoice(updated, updated.items), updated.environment, { autoCalc: updated.autoCalc })] };
}

export async function duplicateInvoice(ctx: Ctx, id: string) {
  const src = await getInvoice(ctx, id);
  const today = karachiNow();
  const input: InvoiceInput = {
    invoiceType: src.invoiceType,
    invoiceDate: today.date, // duplicates always start in the current month (client rule)
    invoiceTime: today.time,
    paymentMode: src.paymentMode,
    invoiceRefNo: src.invoiceRefNo,
    scenarioId: src.scenarioId,
    customerId: src.customerId,
    buyerNtnCnic: src.buyerNtnCnic,
    buyerBusinessName: src.buyerBusinessName,
    buyerProvince: src.buyerProvince,
    buyerAddress: src.buyerAddress,
    buyerRegistrationType: src.buyerRegistrationType,
    autoCalc: src.autoCalc,
    notes: src.notes,
    items: src.items.map((it) => ({
      productId: it.productId,
      saleType: it.saleType,
      hsCode: it.hsCode,
      productDescription: it.productDescription,
      rate: it.rate,
      uom: it.uom,
      quantity: it.quantity.toString(),
      unitPrice: it.unitPrice.toString(),
      discount: it.discount.toString(),
      valueSalesExcludingST: it.valueSalesExcludingST.toString(),
      salesTaxApplicable: it.salesTaxApplicable.toString(),
      retailPricePerUnit: it.retailPricePerUnit?.toString() ?? null,
      fixedNotifiedValueOrRetailPrice: it.fixedNotifiedValueOrRetailPrice.toString(),
      extraTax: it.extraTax.toString(),
      extraTaxEmpty: it.extraTaxEmpty,
      furtherTax: it.furtherTax.toString(),
      fedPayable: it.fedPayable.toString(),
      salesTaxWithheldAtSource: it.salesTaxWithheldAtSource.toString(),
      sroScheduleNo: it.sroScheduleNo,
      sroItemSerialNo: it.sroItemSerialNo,
      totalValues: it.totalValues.toString(),
    })),
  };
  return createInvoice(ctx, input, { environment: src.environment, source: 'DUPLICATE' });
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  const inv = await getInvoice(ctx, id);
  const posts = await prisma.fbrAttempt.count({ where: { invoiceId: id, operation: 'POST' } });
  if (!['DRAFT', 'VALIDATION_FAILED', 'VALIDATED'].includes(inv.status) || posts > 0) {
    throw conflict('Only drafts that were never submitted to FBR can be deleted. Submitted invoices are retained for audit.', undefined, 'NOT_DELETABLE');
  }
  await prisma.$transaction([
    prisma.fbrAttempt.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } }),
    prisma.invoiceSnapshot.deleteMany({ where: { invoiceId: id } }),
    prisma.invoice.delete({ where: { id } }),
  ]);
  return inv;
}

// ------------------------------------------------------------------ buyer registration check
export interface BuyerCheck {
  result: 'NOT_CHECKED' | 'REGISTERED' | 'UNREGISTERED' | 'UNAVAILABLE';
  mismatch: boolean;
  message: string | null;
  checkedAt: string | null;
  verificationId: string | null;
}

export async function checkBuyer(ctx: Ctx, p: { buyerNtnCnic: string; buyerBusinessName: string; buyerRegistrationType: 'REGISTERED' | 'UNREGISTERED' | null }): Promise<BuyerCheck> {
  const regNo = (p.buyerNtnCnic ?? '').trim();
  if (!regNo || ntnCnicProblem(regNo, true)) return { result: 'NOT_CHECKED', mismatch: false, message: null, checkedAt: null, verificationId: null };
  const r = await lookupRegistrationType(ctx.businessId, regNo, ctx.userId);
  if (r.result === 'UNAVAILABLE') {
    return { result: 'UNAVAILABLE', mismatch: false, message: r.message, checkedAt: r.checkedAt.toISOString(), verificationId: r.id };
  }
  const mismatch = !!p.buyerRegistrationType && p.buyerRegistrationType !== r.result;
  return {
    result: r.result,
    mismatch,
    message: mismatch ? mismatchMessage(p.buyerBusinessName, r.result) : null,
    checkedAt: r.checkedAt.toISOString(),
    verificationId: r.id,
  };
}

async function recordBuyerCheck(invoiceId: string, c: BuyerCheck) {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { buyerCheckResult: c.result, buyerCheckAt: c.checkedAt ? new Date(c.checkedAt) : null, buyerCheckId: c.verificationId },
  });
}

function preflight(inv: InvoiceWithItems): { payload: PayloadInvoice; text: string; issues: Issue[] } {
  const payload = toPayloadInvoice(inv, inv.items);
  const text = serializePayload(buildPayload(payload, inv.environment));
  return { payload, text, issues: localValidate(payload, inv.environment, { autoCalc: inv.autoCalc }) };
}

function blockOnErrors(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    const month = errors.find((e) => e.code === 'MONTH_RULE');
    throw new AppError(422, month ? 'MONTH_RULE' : 'LOCAL_VALIDATION', month ? MONTH_RULE_MESSAGE : 'Fix the highlighted fields before sending to FBR', { issues });
  }
}

async function saveItemResults(invoiceId: string, items: { itemSNo: string; statusCode: string; invoiceNo: string | null; errorCode: string | null; error: string | null }[]) {
  const all = await prisma.invoiceItem.findMany({ where: { invoiceId } });
  for (const row of all) {
    const r = items.find((x) => Number(x.itemSNo) === row.lineNo);
    await prisma.invoiceItem.update({
      where: { id: row.id },
      data: {
        fbrItemStatusCode: r?.statusCode ?? null,
        fbrItemErrorCode: r?.errorCode ?? null,
        fbrItemError: r?.error ?? null,
        fbrItemInvoiceNo: r?.invoiceNo && r.statusCode === '00' ? r.invoiceNo : null,
      },
    });
  }
}

async function touchScenario(businessId: string, scenarioId: string | null, outcome: string, passed: { invoiceId: string; fbrNumber: string } | null) {
  if (!scenarioId) return;
  const existing = await prisma.scenarioProgress.findUnique({ where: { businessId_scenarioId: { businessId, scenarioId } } });
  const alreadyPassed = existing?.status === 'PASSED';
  await prisma.scenarioProgress.upsert({
    where: { businessId_scenarioId: { businessId, scenarioId } },
    create: {
      businessId,
      scenarioId,
      status: passed ? 'PASSED' : 'FAILED',
      attempts: 1,
      lastAttemptAt: new Date(),
      lastOutcome: outcome,
      passedAt: passed ? new Date() : null,
      passedInvoiceId: passed?.invoiceId,
      passedFbrNumber: passed?.fbrNumber,
    },
    update: {
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      lastOutcome: outcome,
      ...(passed && !alreadyPassed ? { status: 'PASSED', passedAt: new Date(), passedInvoiceId: passed.invoiceId, passedFbrNumber: passed.fbrNumber } : {}),
      ...(!passed && !alreadyPassed ? { status: 'FAILED' } : {}),
    },
  });
}

// ------------------------------------------------------------------ validate
export interface FbrActionResult {
  invoice: InvoiceWithItems;
  outcome: string;
  attemptId: string | null;
  issues: ExplainedIssue[];
  localIssues: Issue[];
  buyerCheck: BuyerCheck | null;
  httpStatus: number | null;
  rawResponse: string | null;
}

export async function validateWithFbr(ctx: Ctx, id: string): Promise<FbrActionResult> {
  const inv = await getInvoice(ctx, id);
  if (!EDITABLE.includes(inv.status)) throw conflict(`An invoice in status ${inv.status} cannot be validated`, undefined, 'INVALID_STATE');
  const pf = preflight(inv);
  blockOnErrors(pf.issues);
  const bc = await checkBuyer(ctx, pf.payload);
  await recordBuyerCheck(inv.id, bc);
  if (bc.mismatch) {
    throw new AppError(422, 'BUYER_REGISTRATION_MISMATCH', bc.message!, { issues: [{ field: 'buyerRegistrationType', level: 'error', message: bc.message }], buyerCheck: bc });
  }
  // Fail fast on configuration problems (no token / bad URL) without changing the invoice state.
  await resolveCredential(ctx.businessId, inv.environment);
  const lock = await prisma.invoice.updateMany({ where: { id, businessId: ctx.businessId, status: inv.status, version: inv.version }, data: { status: 'VALIDATING' } });
  if (lock.count !== 1) throw conflict('This invoice is being processed. Reload and try again.', undefined, 'BUSY');
  try {
    const r = await callInvoiceApi({
      businessId: ctx.businessId,
      invoiceId: id,
      op: 'VALIDATE',
      env: inv.environment,
      payloadText: pf.text,
      itemCount: inv.items.length,
      scenarioId: inv.scenarioId,
      initiatedById: ctx.userId,
      initiatedKind: ctx.kind ?? 'USER',
    });
    const ok = r.classified.outcome === 'VALID';
    await saveItemResults(id, r.classified.items);
    await prisma.invoice.update({
      where: { id },
      data: ok
        ? { status: 'VALIDATED', validatedHash: payloadHash(pf.text), lastValidatedAt: new Date() }
        : { status: 'VALIDATION_FAILED', validatedHash: null },
    });
    if (ok) {
      await prisma.invoiceSnapshot.create({ data: { invoiceId: id, kind: 'VALIDATED', payloadText: pf.text, payloadHash: payloadHash(pf.text), invoiceData: {}, attemptId: r.attemptId } });
    }
    if (inv.environment === 'SANDBOX') await touchScenario(ctx.businessId, inv.scenarioId, `VALIDATE:${r.classified.outcome}`, null).catch(() => {});
    return {
      invoice: await getInvoice(ctx, id),
      outcome: r.classified.outcome,
      attemptId: r.attemptId,
      issues: await explainIssues(r.classified.issues),
      localIssues: pf.issues,
      buyerCheck: bc,
      httpStatus: r.http.status ?? null,
      rawResponse: r.http.body ?? null,
    };
  } catch (e) {
    // Unexpected internal error: nothing was validated, restore the previous state.
    await prisma.invoice.updateMany({ where: { id, status: 'VALIDATING' }, data: { status: inv.status } });
    throw e;
  }
}

// ------------------------------------------------------------------ submit
export async function submitToFbr(ctx: Ctx, id: string, opts: { retryOfId?: string } = {}): Promise<FbrActionResult> {
  const inv = await getInvoice(ctx, id);
  if (inv.status === 'ACCEPTED') throw conflict(`Already accepted by FBR (${inv.fbrInvoiceNumber}). It cannot be submitted again.`, undefined, 'ALREADY_ACCEPTED');
  if (inv.status === 'RECONCILIATION_REQUIRED') throw conflict('The previous submission outcome is uncertain. Reconcile it before any reattempt.', undefined, 'RECONCILIATION_REQUIRED');
  if (inv.status === 'SUBMITTING' || inv.status === 'VALIDATING') throw conflict('A submission is already in progress for this invoice.', undefined, 'BUSY');
  const pf = preflight(inv);
  // Recheck the current-month rule immediately before submission (old drafts must not bypass it).
  blockOnErrors(pf.issues);
  const hash = payloadHash(pf.text);
  if (inv.status !== 'VALIDATED' || inv.validatedHash !== hash) {
    throw conflict('Validate this invoice with FBR first — it has not been validated, or it changed after validation.', undefined, 'VALIDATION_REQUIRED');
  }
  const bc = await checkBuyer(ctx, pf.payload);
  await recordBuyerCheck(inv.id, bc);
  if (bc.mismatch) {
    throw new AppError(422, 'BUYER_REGISTRATION_MISMATCH', bc.message!, { issues: [{ field: 'buyerRegistrationType', level: 'error', message: bc.message }], buyerCheck: bc });
  }
  await resolveCredential(ctx.businessId, inv.environment); // fail fast before locking
  const lockToken = `${ctx.userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const lock = await prisma.invoice.updateMany({
    where: { id, businessId: ctx.businessId, status: 'VALIDATED', validatedHash: hash, version: inv.version },
    data: { status: 'SUBMITTING', submitLockToken: lockToken, submitLockedAt: new Date() },
  });
  if (lock.count !== 1) throw conflict('Another submission for this invoice is already in progress.', undefined, 'BUSY');

  const snap = await prisma.invoiceSnapshot.create({ data: { invoiceId: id, kind: 'SUBMITTED', payloadText: pf.text, payloadHash: hash, invoiceData: {} } });
  let r;
  try {
    r = await callInvoiceApi({
      businessId: ctx.businessId,
      invoiceId: id,
      op: 'POST',
      env: inv.environment,
      payloadText: pf.text,
      itemCount: inv.items.length,
      scenarioId: inv.scenarioId,
      initiatedById: ctx.userId,
      initiatedKind: ctx.kind ?? 'USER',
      retryOfId: opts.retryOfId,
    });
  } catch (e) {
    // Failure before/around the call without a classified result: outcome unknown -> reconcile.
    await prisma.invoice.update({ where: { id }, data: { status: 'RECONCILIATION_REQUIRED', submitLockToken: null, reconciliationNote: `Internal error during submission: ${String((e as Error).message).slice(0, 200)}` } });
    throw e;
  }
  await prisma.invoiceSnapshot.update({ where: { id: snap.id }, data: { attemptId: r.attemptId } });
  const c = r.classified;
  let status: InvoiceStatus;
  const data: Prisma.InvoiceUpdateInput = { submitLockToken: null };
  if (c.outcome === 'VALID') {
    const clash = await prisma.invoice.findFirst({ where: { fbrInvoiceNumber: c.invoiceNumber!, NOT: { id } } });
    if (clash) {
      status = 'RECONCILIATION_REQUIRED';
      data.reconciliationNote = `FBR returned invoice number ${c.invoiceNumber} which is already recorded on another invoice`;
    } else {
      status = 'ACCEPTED';
      Object.assign(data, { fbrInvoiceNumber: c.invoiceNumber, fbrDated: c.dated, acceptedAt: new Date() });
    }
  } else if (c.outcome === 'INVALID') {
    status = 'REJECTED';
  } else if (c.outcome === 'NOT_SENT' || c.outcome === 'AUTH_ERROR' || (c.outcome === 'HTTP_ERROR' && (r.http.status ?? 0) < 500)) {
    status = 'VALIDATED'; // FBR definitely did not record it — a controlled reattempt is allowed
  } else {
    status = 'RECONCILIATION_REQUIRED'; // UNCERTAIN / BAD_RESPONSE / 5xx
    data.reconciliationNote = c.issues.map((i) => i.message).join(' | ').slice(0, 500);
  }
  data.status = status;
  await prisma.invoice.update({ where: { id }, data });
  await saveItemResults(id, c.items);
  if (status === 'ACCEPTED') {
    await prisma.invoiceSnapshot.create({ data: { invoiceId: id, kind: 'ACCEPTED', payloadText: pf.text, payloadHash: hash, invoiceData: { fbrInvoiceNumber: c.invoiceNumber, dated: c.dated, response: c.json } as Prisma.InputJsonValue, attemptId: r.attemptId } });
  }
  if (inv.environment === 'SANDBOX') {
    await touchScenario(ctx.businessId, inv.scenarioId, `POST:${c.outcome}`, status === 'ACCEPTED' ? { invoiceId: id, fbrNumber: c.invoiceNumber! } : null);
  }
  if (status !== 'ACCEPTED') {
    const label = status === 'RECONCILIATION_REQUIRED' ? 'needs reconciliation' : 'was not accepted';
    await notifyBusiness(ctx.businessId, 'FBR_SUBMISSION_FAILED', `Invoice ${inv.internalNumber} ${label}`, c.issues.map((i) => i.message).join('; ').slice(0, 400), `/app/invoices/${id}`);
    if (inv.environment === 'PRODUCTION') {
      await notifyAdmins('FBR_SUBMISSION_FAILED', `FBR submission ${label}: ${inv.internalNumber}`, `Outcome ${c.outcome}, HTTP ${r.http.status ?? r.http.errorCode}`, `/admin/invoices/${id}`, ctx.businessId);
    }
  }
  return {
    invoice: await getInvoice(ctx, id),
    outcome: c.outcome,
    attemptId: r.attemptId,
    issues: await explainIssues(c.issues),
    localIssues: pf.issues,
    buyerCheck: bc,
    httpStatus: r.http.status ?? null,
    rawResponse: r.http.body ?? null,
  };
}

// ------------------------------------------------------------------ reconciliation
const FBR_NO_RE = /^\d{7,13}DI\d{10,}$/;

export async function reconcileAccepted(ctx: Ctx, id: string, fbrInvoiceNumber: string, note: string) {
  const inv = await getInvoice(ctx, id);
  if (inv.status !== 'RECONCILIATION_REQUIRED') throw conflict('Only invoices that require reconciliation can be reconciled');
  const num = fbrInvoiceNumber.trim();
  if (!FBR_NO_RE.test(num)) throw unprocessable('Enter the FBR invoice number exactly as shown in the IRIS Invoice Dashboard (e.g. 7000007DI1747119701593)');
  if (await prisma.invoice.findFirst({ where: { fbrInvoiceNumber: num } })) throw conflict('That FBR invoice number is already recorded on another invoice');
  const lastSubmitted = await prisma.invoiceSnapshot.findFirst({ where: { invoiceId: id, kind: 'SUBMITTED' }, orderBy: { createdAt: 'desc' } });
  await prisma.$transaction([
    prisma.invoice.update({ where: { id }, data: { status: 'ACCEPTED', fbrInvoiceNumber: num, acceptedAt: new Date(), acceptedViaReconcile: true, reconciliationNote: note } }),
    prisma.invoiceSnapshot.create({
      data: { invoiceId: id, kind: 'ACCEPTED', payloadText: lastSubmitted?.payloadText ?? payloadTextFor(inv), payloadHash: lastSubmitted?.payloadHash ?? inv.payloadHash ?? '', invoiceData: { fbrInvoiceNumber: num, reconciledBy: ctx.userId, note } },
    }),
  ]);
  if (inv.environment === 'SANDBOX') await touchScenario(ctx.businessId, inv.scenarioId, 'RECONCILED_ACCEPTED', { invoiceId: id, fbrNumber: num });
  return getInvoice(ctx, id);
}

export async function reconcileNotRecorded(ctx: Ctx, id: string, note: string) {
  const inv = await getInvoice(ctx, id);
  if (inv.status !== 'RECONCILIATION_REQUIRED') throw conflict('Only invoices that require reconciliation can be reconciled');
  // Back to draft: a reattempt must re-validate and pass the current-month rule again.
  await prisma.invoice.update({ where: { id }, data: { status: 'DRAFT', validatedHash: null, reconciliationNote: note, version: { increment: 1 } } });
  return getInvoice(ctx, id);
}

/** Crash safety: an invoice stuck in SUBMITTING means the outcome is unknown. */
export async function sweepStaleLocks(minutes = 5) {
  const cutoff = new Date(Date.now() - minutes * 60_000);
  const stuck = await prisma.invoice.updateMany({
    where: { status: 'SUBMITTING', submitLockedAt: { lt: cutoff } },
    data: { status: 'RECONCILIATION_REQUIRED', submitLockToken: null, reconciliationNote: 'Submission was interrupted (process restart or crash). Check the IRIS Invoice Dashboard before any reattempt.' },
  });
  const v = await prisma.invoice.updateMany({ where: { status: 'VALIDATING', updatedAt: { lt: cutoff } }, data: { status: 'VALIDATION_FAILED' } });
  return { submitting: stuck.count, validating: v.count };
}

// ------------------------------------------------------------------ DTO
const s = (d: Decimal | Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : d.toString());

export function invoiceDto(inv: InvoiceWithItems) {
  return {
    id: inv.id,
    environment: inv.environment,
    internalNumber: inv.internalNumber,
    invoiceType: inv.invoiceType,
    invoiceDate: dateOnlyToIso(inv.invoiceDate),
    invoiceTime: inv.invoiceTime,
    paymentMode: inv.paymentMode,
    invoiceRefNo: inv.invoiceRefNo,
    scenarioId: inv.scenarioId,
    seller: { ntnCnic: inv.sellerNtnCnic, businessName: inv.sellerBusinessName, province: inv.sellerProvince, address: inv.sellerAddress },
    customerId: inv.customerId,
    buyerNtnCnic: inv.buyerNtnCnic,
    buyerBusinessName: inv.buyerBusinessName,
    buyerProvince: inv.buyerProvince,
    buyerAddress: inv.buyerAddress,
    buyerRegistrationType: inv.buyerRegistrationType,
    buyerCheck: { result: inv.buyerCheckResult, checkedAt: inv.buyerCheckAt?.toISOString() ?? null },
    status: inv.status,
    source: inv.source,
    autoCalc: inv.autoCalc,
    notes: inv.notes,
    totals: {
      valueExclST: s(inv.totalValueExclST),
      salesTax: s(inv.totalSalesTax),
      furtherTax: s(inv.totalFurtherTax),
      extraTax: s(inv.totalExtraTax),
      fed: s(inv.totalFed),
      withheld: s(inv.totalWithheld),
      discount: s(inv.totalDiscount),
      grandTotal: s(inv.grandTotal),
      netReceivable: s(inv.netReceivable),
    },
    fbrInvoiceNumber: inv.fbrInvoiceNumber,
    fbrDated: inv.fbrDated,
    acceptedAt: inv.acceptedAt?.toISOString() ?? null,
    acceptedViaReconcile: inv.acceptedViaReconcile,
    reconciliationNote: inv.reconciliationNote,
    validated: inv.status === 'VALIDATED' && !!inv.validatedHash && inv.validatedHash === inv.payloadHash,
    lastValidatedAt: inv.lastValidatedAt?.toISOString() ?? null,
    rawTemplateDiff: inv.rawTemplateDiff,
    importRef: inv.importRef,
    version: inv.version,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
    items: inv.items.map((it) => ({
      id: it.id,
      lineNo: it.lineNo,
      productId: it.productId,
      saleType: it.saleType,
      hsCode: it.hsCode,
      productDescription: it.productDescription,
      rate: it.rate,
      uom: it.uom,
      quantity: s(it.quantity),
      unitPrice: s(it.unitPrice),
      discount: s(it.discount),
      valueSalesExcludingST: s(it.valueSalesExcludingST),
      salesTaxApplicable: s(it.salesTaxApplicable),
      retailPricePerUnit: s(it.retailPricePerUnit),
      fixedNotifiedValueOrRetailPrice: s(it.fixedNotifiedValueOrRetailPrice),
      extraTax: s(it.extraTax),
      extraTaxEmpty: it.extraTaxEmpty,
      furtherTax: s(it.furtherTax),
      fedPayable: s(it.fedPayable),
      salesTaxWithheldAtSource: s(it.salesTaxWithheldAtSource),
      sroScheduleNo: it.sroScheduleNo,
      sroItemSerialNo: it.sroItemSerialNo,
      totalValues: s(it.totalValues),
      fbr: { itemInvoiceNo: it.fbrItemInvoiceNo, statusCode: it.fbrItemStatusCode, errorCode: it.fbrItemErrorCode, error: it.fbrItemError },
    })),
  };
}

export type InvoiceDto = ReturnType<typeof invoiceDto>;
export { Decimal };
