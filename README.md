# AI Bookkeeper (test build)

A multi-tenant "AI bookkeeper" for an accounting firm. This repo is the **sandbox-only test build**: prove the full loop against the QuickBooks Online **sandbox** before any real client books are touched.

> Build spec lives in [`CLAUDE.md`](CLAUDE.md). Setup/first-session steps live in [`START_HERE.md`](START_HERE.md).

## Stack

- **Cloudflare Worker** (Hono, TypeScript) — API + OAuth + cron + (later) queue consumer
- **Cloudflare D1** — relational store (tokens, mappings, cache, rules, audit)
- **Cloudflare KV** — short-lived cache (chart of accounts, OAuth state)
- **Cloudflare Pages** — dashboard (Phase 1)
- **Anthropic API** — categorization (Phase 1, server-side only)

## Status

- **Phase 0 — Foundation: ✅ complete — gate passed 2026-06-16.** OAuth connect/callback, self-rotating token refresh (atomic refresh-token persistence), D1 schema, QBO `query()` client. Proven on the QuickBooks Online sandbox: a company connects via OAuth, the hourly cron refreshes its access token unattended, and `SELECT * FROM CompanyInfo` returns live data. Security/correctness review: [`docs/security-review-phase0.md`](docs/security-review-phase0.md).
- **Phase 1 — read, classify, reconcile prep, dashboard:** stages 1–4 ✅ built & deployed (sync, AI categorization with learned rules, reconciliation prep, and the Pages dashboard). **Stage 5 remaining:** Cloudflare Access on the dashboard + the non-technical gate test. Resume guide: [`HANDOFF.md`](HANDOFF.md).

## Layout

```
wrangler.toml          Worker + bindings (D1, KV, Cron; Queue deferred to Phase 1)
migrations/            D1 SQL migrations
worker/src/
  index.ts             Hono app entry + scheduled() handler
  constants.ts         Intuit endpoints, API base, scopes, tunables
  types.ts             Env + row types
  crypto.ts            AES-GCM encrypt/decrypt for tokens at rest
  db.ts                D1 helpers (realms, audit)
  oauth.ts             connect, callback, token exchange + refresh (HTTP)
  qbo.ts               QBO API client: valid-token mgmt + query()
  cron.ts              scheduled token-refresh sweep
  webhook.ts           Intuit CDC receiver (signature-verified; Phase 1 processing)
shared/                types shared by worker + dashboard
```

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars     # then fill in sandbox keys + TOKEN_ENC_KEY
npm run db:migrate:local           # apply schema to local D1
npm run dev                        # http://localhost:8787
```

Generate a token-encryption key with `openssl rand -base64 32`.

## Deploy

```bash
npm run db:migrate:remote          # apply schema to remote D1
npm run deploy                     # deploy Worker; note the *.workers.dev URL
# then set production secrets:
wrangler secret put QBO_CLIENT_ID
wrangler secret put QBO_CLIENT_SECRET
wrangler secret put QBO_REDIRECT_URI     # https://<worker>.workers.dev/oauth/callback
wrangler secret put TOKEN_ENC_KEY
```

Set the same redirect URI in the Intuit app's **Keys & credentials → Redirect URIs**.

## Routes (Phase 0)

| Route | Purpose |
|---|---|
| `GET /` | Health + connected-company count |
| `GET /oauth/connect` | Redirect to Intuit to authorize a sandbox company |
| `GET /oauth/callback` | Exchange code, encrypt + store tokens, capture `realmId` |
| `GET /api/company` | Run `CompanyInfo` query for the connected realm (proves the loop) |
| `POST /webhook/qbo` | Intuit CDC receiver (signature-verified; processing in Phase 1) |
| Cron `0 * * * *` | Refresh tokens nearing expiry; persist rotated refresh token |
