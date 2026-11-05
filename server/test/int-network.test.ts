/** Integration: network failure modes and secret hygiene (MOCKED FBR; the mock is stopped to simulate an unreachable gateway). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import pino from 'pino';
import { MockFbr, PATHS } from './mockFbr';
import { call, createInvoice, fixClock, getApp, newUser, prisma, realClock, resetDb, saveCredential, type Session } from './helpers';
import { REDACT } from '../src/app';

const mock = new MockFbr();
let app: FastifyInstance;
let s: Session;

beforeAll(async () => {
  await mock.start();
  app = await getApp();
});
beforeEach(async () => {
  fixClock();
  await resetDb();
  if (!mock.server) await mock.start();
  mock.reset();
  s = await newUser(app, { ntn: '5555555', businessName: 'Echo' });
  await saveCredential(app, s, 'SANDBOX', 'sandbox-token-echo-4242');
});
afterAll(async () => {
  realClock();
  await mock.stop();
  await app.close();
  await prisma.$disconnect();
});

describe('unreachable FBR gateway (connection refused)', () => {
  it('validation fails safely and post is NOT_SENT -> invoice stays VALIDATED (no reconciliation needed)', async () => {
    const inv = await createInvoice(app, s);
    expect((await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {})).json().outcome).toBe('VALID');
    await mock.stop();
    const sub = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().outcome).toBe('NOT_SENT');
    expect(sub.json().invoice.status).toBe('VALIDATED');
    expect(sub.json().issues[0]).toMatchObject({ scope: 'NETWORK', message: expect.stringMatching(/not delivered/) });
    const inv2 = await createInvoice(app, s);
    const v = await call(app, s, 'POST', `/api/app/invoices/${inv2.id}/validate`, {});
    expect(v.json().outcome).not.toBe('VALID');
    expect(v.json().invoice.status).toBe('VALIDATION_FAILED');
    await mock.start();
    const retry = await call(app, s, 'POST', `/api/app/invoices/${inv.id}/submit`, {});
    expect(retry.json().invoice.status).toBe('ACCEPTED');
    expect(mock.calls(PATHS.postSb)).toHaveLength(1);
  });

  it('connection test reports the gateway as unreachable without changing invoices', async () => {
    await mock.stop();
    const t = await call(app, s, 'POST', '/api/app/fbr/credentials/sandbox/test', {});
    expect(t.json().result.status).toBe('ERROR');
    expect(t.json().result.message).toMatch(/Could not reach FBR/);
  });
});

describe('extraTax "send as empty"', () => {
  it('an item flagged extraTaxEmpty is sent with extraTax ""', async () => {
    const inv = await createInvoice(app, s, {}, { extraTaxEmpty: true });
    await call(app, s, 'POST', `/api/app/invoices/${inv.id}/validate`, {});
    expect(mock.calls(PATHS.validateSb)[0].json.items[0].extraTax).toBe('');
  });
});

describe('sessions', () => {
  it('idle sessions expire', async () => {
    await prisma.session.updateMany({ where: { userId: s.userId }, data: { lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    expect((await call(app, s, 'GET', '/api/app/invoices')).statusCode).toBe(401);
  });
  it('logout revokes the session', async () => {
    expect((await call(app, s, 'POST', '/api/auth/logout', {})).statusCode).toBe(200);
    expect((await call(app, s, 'GET', '/api/app/invoices')).statusCode).toBe(401);
  });
});

describe('log redaction', () => {
  it('authorization headers, cookies, CSRF tokens, passwords and tokens are redacted', () => {
    let out = '';
    const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
    const log = pino({ redact: { paths: REDACT, censor: '[REDACTED]' } }, sink);
    log.info({ req: { headers: { authorization: 'Bearer TOPSECRET', cookie: 'ig_session=SESSIONSECRET', 'x-csrf-token': 'CSRFSECRET' } }, body: { password: 'PWSECRET', token: 'TOKSECRET' } }, 'request');
    expect(out).not.toMatch(/TOPSECRET|SESSIONSECRET|CSRFSECRET|PWSECRET|TOKSECRET/);
    expect(out).toContain('[REDACTED]');
  });
});
