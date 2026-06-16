import { Hono } from 'hono';
import type { Env } from './types';
import { handleConnect, handleCallback } from './oauth';
import { handleWebhook } from './webhook';
import { query } from './qbo';
import { listActiveRealms } from './db';
import { runTokenRefreshSweep } from './cron';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const realms = await listActiveRealms(c.env);
  return c.json({
    service: 'ai-bookkeeper',
    status: 'ok',
    environment: c.env.QBO_ENVIRONMENT,
    connectedCompanies: realms.length,
  });
});

app.get('/oauth/connect', handleConnect);
app.get('/oauth/callback', handleCallback);

// Proves the Phase 0 loop: fetch CompanyInfo for the connected realm via query().
app.get('/api/company', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const data = await query(c.env, realm, 'SELECT * FROM CompanyInfo');
  return Response.json(data);
});

app.post('/webhook/qbo', handleWebhook);

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      runTokenRefreshSweep(env).catch((err) => {
        console.error('token refresh sweep failed', err);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
