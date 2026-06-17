import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleConnect, handleCallback } from './oauth';
import { handleWebhook } from './webhook';
import { z } from 'zod';
import { query, report } from './qbo';
import { runSync, type CoaEntry } from './sync';
import { categorizePending } from './categorize';
import { reconcile, parseStatementCsv } from './reconcile';
import {
  listActiveRealms,
  listTransactions,
  getTransaction,
  approveTransaction,
  adjustTransaction,
  insertRule,
  audit,
} from './db';
import { runTokenRefreshSweep } from './cron';

type AppContext = Context<{ Bindings: Env }>;

// Constant-time compare so a wrong secret can't be probed byte-by-byte.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Gate /api/* and /oauth/connect behind the secret the Pages BFF presents.
// Fails closed if the secret isn't configured, so a half-finished deploy is
// locked rather than open.
async function bffAuth(c: AppContext, next: Next) {
  const expected = c.env.BFF_SHARED_SECRET;
  if (!expected) return c.json({ error: 'auth_not_configured' }, 503);
  if (!safeEqual(c.req.header('X-BFF-Secret') ?? '', expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}

async function statusHandler(c: AppContext) {
  const realms = await listActiveRealms(c.env);
  return c.json({
    service: 'ai-bookkeeper',
    status: 'ok',
    environment: c.env.QBO_ENVIRONMENT,
    connectedCompanies: realms.length,
  });
}

const app = new Hono<{ Bindings: Env }>();

// The browser only ever calls the same-origin Pages BFF, which proxies here with
// the shared secret. CORS is locked to the dashboard origin as defense-in-depth;
// any stray cross-origin browser call without the secret is rejected by bffAuth.
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = (c.env as Env).DASHBOARD_URL;
      return allowed && origin === allowed ? origin : undefined;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-BFF-Secret'],
  }),
);

// Secret-gate the data paths and OAuth initiation. `/` (health),
// `/oauth/callback` (state-protected) and `/webhook/qbo` (signature-protected)
// stay directly reachable.
app.use('/api/*', bffAuth);
app.use('/oauth/connect', bffAuth);

app.get('/', statusHandler); // public health check (no metered reads, no sensitive data)
app.get('/api/status', statusHandler); // same payload via the BFF, for the dashboard

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

// Pull chart of accounts (→ KV) and posted Purchases (→ D1). Manual trigger for
// the test; production drives this from the webhook/cron, never by polling.
app.post('/api/sync', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const result = await runSync(c.env, realm);
  return c.json({ ok: true, ...result });
});

// Review-queue data: synced transactions (optionally filtered by review_status).
app.get('/api/transactions', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const status = c.req.query('status');
  const transactions = await listTransactions(c.env, realm.realm_id, status);
  return c.json({ transactions });
});

// Run categorization (rules pass, then Claude for the remainder) over pending txns.
app.post('/api/categorize', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'anthropic_key_not_configured' }, 503);
  const result = await categorizePending(c.env, realm);
  return c.json({ ok: true, ...result });
});

// Approve a transaction's current/suggested category.
app.post('/api/transactions/:id/approve', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const txn = await getTransaction(c.env, id, realm.realm_id);
  if (!txn) return c.json({ error: 'not_found' }, 404);
  await approveTransaction(c.env, id);
  await audit(c.env, {
    realm_id: realm.realm_id,
    actor: 'user',
    action: 'transaction_approved',
    detail_json: JSON.stringify({ id, account: txn.suggested_account ?? txn.account_qbo_id }),
  });
  return c.json({ ok: true });
});

// Adjust a transaction's category; learn a rule so the same payee is deterministic next time.
app.post('/api/transactions/:id/adjust', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const parsed = z.object({ account_qbo_id: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'account_qbo_id_required' }, 400);
  const txn = await getTransaction(c.env, id, realm.realm_id);
  if (!txn) return c.json({ error: 'not_found' }, 404);
  await adjustTransaction(c.env, id, parsed.data.account_qbo_id);
  if (txn.payee) {
    await insertRule(c.env, {
      realmId: realm.realm_id,
      matchField: 'payee',
      matchOp: 'equals',
      matchValue: txn.payee,
      accountQboId: parsed.data.account_qbo_id,
      source: 'human',
    });
  }
  await audit(c.env, {
    realm_id: realm.realm_id,
    actor: 'user',
    action: 'transaction_adjusted',
    detail_json: JSON.stringify({ id, account: parsed.data.account_qbo_id, ruleWritten: !!txn.payee }),
  });
  return c.json({ ok: true, ruleWritten: !!txn.payee });
});

// Reconciliation prep: match posted transactions in [from,to] against an uploaded
// bank-statement CSV; return matched / book-only / statement-only buckets + flags.
app.post('/api/reconcile', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const parsed = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      csv: z.string().min(1),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', detail: 'need from, to (YYYY-MM-DD), and csv' }, 400);
  }
  const lines = parseStatementCsv(parsed.data.csv);
  const worksheet = await reconcile(c.env, realm, parsed.data.from, parsed.data.to, lines);
  return c.json(worksheet);
});

// Chart of accounts (from KV) so the dashboard can show category names.
app.get('/api/accounts', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const raw = await c.env.COA_CACHE.get(`coa:${realm.realm_id}`);
  const accounts: CoaEntry[] = raw ? (JSON.parse(raw) as CoaEntry[]) : [];
  return c.json({ accounts });
});

// Reports — read on demand (never polled), per the read-discipline constraint.
app.get('/api/reports/pnl', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const data = await report(c.env, realm, 'ProfitAndLoss', from && to ? { start_date: from, end_date: to } : {});
  return Response.json(data);
});

app.get('/api/reports/balance-sheet', async (c) => {
  const realms = await listActiveRealms(c.env);
  const realm = realms[0];
  if (!realm) return c.json({ error: 'no_connected_company' }, 404);
  const to = c.req.query('to');
  const data = await report(c.env, realm, 'BalanceSheet', to ? { end_date: to } : {});
  return Response.json(data);
});

app.post('/webhook/qbo', handleWebhook);

// Catch-all error handler. err.message is redacted (qbo.ts/oauth.ts no longer
// embed raw Intuit bodies), so logging name + message is safe; the client gets a
// generic error.
app.onError((err, c) => {
  console.error('request_error', err.name, err.message);
  return c.json({ error: 'internal_error' }, 500);
});

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
