/**
 * Vercel serverless entry: every /api/* request is rewritten here (see vercel.json) and handled
 * by the same Fastify application that runs on a VM. The app is built once per function
 * instance and reused across invocations.
 */
let ready;

async function init() {
  const { buildApp } = await import('../server/dist/src/app.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * vercel.json rewrites /api/:path* to /api/index?path=:path*. Depending on the runtime the
 * function sees either the original URL or the rewritten one; normalise to the original.
 */
export function originalUrl(url) {
  const u = new URL(url ?? '/', 'http://local');
  if (u.pathname !== '/api/index' && u.pathname !== '/api') return url;
  const path = u.searchParams.get('path');
  if (path === null) return url;
  u.searchParams.delete('path');
  const rest = u.searchParams.toString();
  return `/api/${path.replace(/^\/+/, '')}${rest ? `?${rest}` : ''}`;
}

export default async function handler(req, res) {
  req.url = originalUrl(req.url);
  try {
    ready ??= init();
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (err) {
    ready = undefined; // retry initialisation on the next request
    const message = String(err?.message ?? err);
    // Configuration errors name the missing variables only — never values.
    const configError = /Invalid environment configuration|DATA_ENCRYPTION_KEY|DATABASE_URL|must be/i.test(message);
    console.error('InvoiceGO API initialisation failed:', message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'SERVER_NOT_CONFIGURED',
          message: configError ? `Server is not configured yet: ${message}` : 'The server could not start. Check the function logs in Vercel.',
        },
      }),
    );
  }
}
