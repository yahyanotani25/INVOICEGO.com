/**
 * MOCKED FBR / PRAL gateway for automated tests ONLY.
 *
 * These responses imitate the shapes documented in the DI API Technical Specification v1.12
 * (§4.1.3–4.1.5, §5.1, §5.12). They are NOT real FBR responses and passing tests against this
 * mock is NOT evidence of acceptance by the real FBR sandbox or production systems.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MOCK_ORIGIN, MOCK_PORT } from './env';

export interface MockRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
  json: any;
}

export interface MockReply {
  status?: number;
  body?: unknown; // object -> JSON, string -> raw
  delayMs?: number;
  hang?: boolean;
}

type Handler = (req: MockRequest) => MockReply;

export const PATHS = {
  postSb: '/di_data/v1/di/postinvoicedata_sb',
  validateSb: '/di_data/v1/di/validateinvoicedata_sb',
  post: '/di_data/v1/di/postinvoicedata',
  validate: '/di_data/v1/di/validateinvoicedata',
  provinces: '/pdi/v1/provinces',
  regType: '/dist/v1/Get_Reg_Type',
};

export const URLS = {
  SANDBOX: { postUrl: MOCK_ORIGIN + PATHS.postSb, validateUrl: MOCK_ORIGIN + PATHS.validateSb },
  PRODUCTION: { postUrl: MOCK_ORIGIN + PATHS.post, validateUrl: MOCK_ORIGIN + PATHS.validate },
};

let counter = 1747119701593;
export function fbrNumber(prefix = '7000007') {
  counter += 1;
  return `${prefix}DI${counter}`;
}

const itemCount = (req: MockRequest) => (Array.isArray(req.json?.items) ? req.json.items.length : 1);

/** §4.2.3-shaped valid validation response (MOCKED). */
export function validValidate(req: MockRequest): MockReply {
  return {
    body: {
      dated: '2026-11-15 12:01:41',
      validationResponse: {
        statusCode: '00',
        status: 'Valid',
        errorCode: null,
        error: '',
        invoiceStatuses: Array.from({ length: itemCount(req) }, (_, i) => ({ itemSNo: String(i + 1), statusCode: '00', status: 'Valid', errorCode: null, error: '' })),
      },
    },
  };
}

/** §4.1.3-shaped valid post response with an invoice number (MOCKED). */
export function validPost(req: MockRequest): MockReply {
  const n = fbrNumber();
  return {
    body: {
      invoiceNumber: n,
      dated: '2026-11-15 12:01:41',
      validationResponse: {
        statusCode: '00',
        status: 'Valid',
        error: '',
        invoiceStatuses: Array.from({ length: itemCount(req) }, (_, i) => ({ itemSNo: String(i + 1), statusCode: '00', status: 'Valid', invoiceNo: `${n}-${i + 1}`, errorCode: '', error: '' })),
      },
    },
  };
}

/** §4.1.4-shaped header-level invalid response (MOCKED). */
export function headerInvalid(): MockReply {
  return { body: { dated: '2026-11-15 13:09:05', validationResponse: { statusCode: '01', status: 'Invalid', errorCode: '0052', error: 'Provide proper HS Code with invoice no. null', invoiceStatuses: null } } };
}

/** §4.1.5-shaped item-level invalid response: header "00" but item "01" (MOCKED). */
export function itemInvalid(req: MockRequest): MockReply {
  return {
    body: {
      dated: '2026-11-15 13:10:00',
      validationResponse: {
        statusCode: '00',
        status: 'invalid',
        error: '',
        invoiceStatuses: Array.from({ length: itemCount(req) }, (_, i) => ({ itemSNo: String(i + 1), statusCode: '01', status: 'Invalid', invoiceNo: null, errorCode: '0046', error: 'Provide rate.' })),
      },
    },
  };
}

export class MockFbr {
  server: Server | null = null;
  requests: MockRequest[] = [];
  handlers: Record<string, Handler> = {};
  /** Get_Reg_Type answers per registration number: 'Registered' | 'unregistered' | 'hang' | 'error' */
  regTypes: Record<string, 'Registered' | 'unregistered' | 'hang' | 'error'> = {};

  reset() {
    this.requests = [];
    this.regTypes = {};
    this.handlers = {
      [PATHS.validateSb]: validValidate,
      [PATHS.validate]: validValidate,
      [PATHS.postSb]: validPost,
      [PATHS.post]: validPost,
      [PATHS.provinces]: () => ({ body: [{ stateProvinceCode: 7, stateProvinceDesc: 'PUNJAB' }, { stateProvinceCode: 8, stateProvinceDesc: 'SINDH' }] }),
      [PATHS.regType]: (req) => {
        const no = String(req.json?.Registration_No ?? '');
        const t = this.regTypes[no];
        if (!t || t === 'error') return { status: 500, body: 'Internal Server Error' };
        if (t === 'hang') return { hang: true };
        return { body: t === 'Registered' ? { statuscode: '00', REGISTRATION_NO: no, REGISTRATION_TYPE: 'Registered' } : { statuscode: '01', REGISTRATION_NO: no, REGISTRATION_TYPE: 'unregistered' } };
      },
    };
  }

  on(path: string, h: Handler) {
    this.handlers[path] = h;
  }

  calls(path: string) {
    return this.requests.filter((r) => r.path === path);
  }

  async start() {
    this.reset();
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const path = (req.url ?? '').split('?')[0];
        let json: any = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = null;
        }
        const r: MockRequest = { method: req.method ?? 'GET', path, headers: req.headers, body, json };
        this.requests.push(r);
        const h = this.handlers[path];
        const reply: MockReply = h ? h(r) : { status: 404, body: 'not found' };
        if (reply.hang) return; // never answer
        const send = () => {
          if (res.writableEnded || res.destroyed) return;
          const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
          res.writeHead(reply.status ?? 200, { 'content-type': typeof reply.body === 'string' ? 'text/plain' : 'application/json' });
          res.end(payload);
        };
        if (reply.delayMs) setTimeout(send, reply.delayMs);
        else send();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(MOCK_PORT, '127.0.0.1', () => resolve()));
  }

  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
