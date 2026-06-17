# AI Bookkeeper — Handoff / Resume Guide

_Last updated: 2026-06-16._ This is the cold-start guide: read `CLAUDE.md` (build spec) + `START_HERE.md` (setup) for full context, then this file for current state and what's next.

## Status at a glance

| Phase | State |
|---|---|
| **Phase 0 — Foundation** (OAuth, self-rotating token refresh, D1, QBO query) | ✅ **Done, gate passed** |
| **Phase 1 — Read / classify / reconcile / dashboard** | ✅ **Done, gate passed** — stages 1–5, Access live, security-hardened |

**Phase 1 is complete and gate-passed (2026-06-16).** Cloudflare Access is live (One-time PIN); the owner walked all four screens (Home → Review → Reconcile → Reports) end-to-end with no issues, and the API is security-hardened (BFF + shared secret, see below). The sandbox test build meets its Definition of Done. Next up is **Phase 2** (write-back to QBO, production keys + Intuit assessment, multi-realm, Plaid) — plus, optionally, a later AI-categorization test pass by the firm's client.

## Live resources

| Thing | Value |
|---|---|
| Worker (API) | https://ai-bookkeeper.tgqhg6kf4g.workers.dev |
| Dashboard (Pages) | https://ai-bookkeeper-dashboard.pages.dev |
| GitHub repo | https://github.com/shizzoobies/PBJAIBookkeeper |
| Cloudflare account | `tgqhg6kf4g@privaterelay.appleid.com` |
| D1 database | `ai-bookkeeper` (`e8fc1ba9-d795-4ed0-90f6-aaf65785508d`) |
| KV namespace | `COA_CACHE` (`18ef94df3f5f4a2c87528cc80ba8b633`) |
| Cron | hourly token-refresh sweep (`0 * * * *`) |
| Connected sandbox realm | `9341457287450454` — "Sandbox Company US 64f6", status `active` |

**Secrets** (set via `wrangler secret put`; values live only in Cloudflare): `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY` — all set. **Phase 1 hardening added `BFF_SHARED_SECRET`** — now set on the **Worker** *and* the **Pages** project (same value); gating is **live as of 2026-06-16**.

**Intuit:** app is under the owner's **personal** Intuit account using **Development (sandbox)** keys. Redirect URI registered: `https://ai-bookkeeper.tgqhg6kf4g.workers.dev/oauth/callback`. A sandbox company (QBO Plus, US) exists. For production the app must move to the **firm's** account and pass Intuit's app assessment.

## What's proven live (sandbox)

- OAuth connect → encrypted token storage (AES-GCM) → self-rotating refresh with **atomic** persistence; hourly cron verified refreshing unattended.
- **Sync:** 89 accounts → KV (`coa:<realm>`), 35 posted Purchases → D1.
- **Categorize:** rules pass → Claude (Haiku) classifier, confidence-scored. Correcting one vendor **learns a rule** that auto-categorized its 6 siblings at confidence 1.0 with **zero** AI calls.
- **Reconcile:** matched / on-books-only / on-statement-only buckets + duplicate & stale flags (tested with a crafted May statement: 23 matched incl. a date-shifted + reworded line, 7 book-only, 2 statement-only, 5 stale).
- **Dashboard:** 4 screens (Home/Connect, Review, Reconcile, Reports) deployed to Pages; CORS to the Worker verified.

## Worker API endpoints

| Method · Path | Purpose |
|---|---|
| `GET /` | status (`connectedCompanies`) |
| `GET /oauth/connect`, `GET /oauth/callback` | OAuth |
| `GET /api/company` | CompanyInfo |
| `GET /api/accounts` | chart of accounts (from KV) |
| `POST /api/sync` | pull COA + Purchases |
| `GET /api/transactions[?status=pending]` | review-queue data |
| `POST /api/categorize` | rules → Claude over pending txns |
| `POST /api/transactions/:id/approve` | approve |
| `POST /api/transactions/:id/adjust` `{account_qbo_id}` | correct + learn a rule |
| `POST /api/reconcile` `{from,to,csv}` | reconciliation worksheet |
| `GET /api/reports/pnl?from=&to=`, `GET /api/reports/balance-sheet?to=` | reports |
| Cron `0 * * * *` | token refresh sweep |

## ✅ Stage 5 — DONE (2026-06-16)

**1. Add Cloudflare Access to the dashboard.** ✅ **Done.** Zero Trust → Access → Applications → Self-hosted for `ai-bookkeeper-dashboard.pages.dev`, Allow policy on emails `asoalexander@gmail.com` + `alex@mbsdoc.com`, One-time PIN login. Owner tested the email-link login — works.

**2. Non-technical gate test.** ✅ **Passed.** The owner logged in and clicked through all four screens end-to-end with no issues — the flow a non-technical user follows, with no instructions:
- See the connected company + a "needs your review" count on Home.
- Open **Review**, see transactions with AI categories + a plain confidence signal, **approve** some and **adjust** one.
- Open **Reconciliation**, pick a period, upload a bank CSV, and read the three buckets + flags.
- Open **Reports** and load P&L / Balance Sheet.

A sample statement CSV for testing reconciliation lives in `.omc/recon-test.mjs` (gitignored) — it targets the May sandbox transactions.

## Phase 1 hardening (before production / real keys)

Tracked in `docs/security-review-phase0.md`.

**✅ Done & live (2026-06-16) — verified: Worker `/api/*` returns 401 without the secret; `/` health still 200; Pages `/api/*` → 302 Access:**
- **H1/H2 + CORS** — `/api/*` and `/oauth/connect` are now gated behind a **shared secret** (`X-BFF-Secret`, fail-closed) that only the dashboard's **Pages Functions BFF** (`dashboard/functions/`) holds. The SPA calls **same-origin** `/api/*`; the BFF (behind Cloudflare Access) proxies to the Worker with the secret. Worker CORS is locked to `DASHBOARD_URL`. The browser never reaches the Worker directly. Independent review of the diff: no CRITICAL/HIGH findings.
- **M1** — raw Intuit/QBO response bodies no longer reach logs/errors.
- **L3** — OAuth callback redirects into the dashboard (`?connected=1` / `?error=…`) instead of raw JSON.

**Still open (fine for single-realm sandbox; address before real keys):**
- **M2** — serialize per-realm token refresh with a lock / Durable Object (today: lightweight re-read mitigation).
- **L1** — multi-tenant realm selection (the API still uses `realms[0]`); required before connecting >1 company.
- Belt-and-suspenders for real keys: validate the Access JWT (`Cf-Access-Jwt-Assertion`) inside the BFF; rotate `BFF_SHARED_SECRET` periodically.
- Write-back to QBO and Plaid ingestion remain **out of scope** (Phase 2).

### Deploy the hardening — ✅ done 2026-06-16 (commands kept for re-deploys / rotation)

```bash
# 1) Generate the shared secret ONCE; use the SAME value in both places below.
openssl rand -base64 32

# 2) Worker (from repo root): paste the value at the prompt, then deploy.
wrangler secret put BFF_SHARED_SECRET
npm run deploy

# 3) Pages: set the SAME value, then build + deploy the dashboard (with its BFF).
cd dashboard
wrangler pages secret put BFF_SHARED_SECRET --project-name=ai-bookkeeper-dashboard
npm run build && wrangler pages deploy
```

The Worker fails **closed** (`/api/*` → 503) until its secret is set, and the BFF returns 503 until the Pages secret is set — so set both and deploy both. `WORKER_ORIGIN` and `DASHBOARD_URL` are committed in the two `wrangler.toml`s; only the secret is manual.

## Dev commands

```bash
# Worker
npm run typecheck
npm run deploy
npm run db:migrate:remote        # apply migrations to remote D1
wrangler tail                    # live logs
wrangler secret list             # confirm secrets (names only)

# Dashboard (has its own dashboard/wrangler.toml: pages_build_output_dir + the functions/ BFF)
cd dashboard && npm install && npm run build
wrangler pages deploy            # auto-bundles ./dist + ./functions; project name comes from the config

# Re-discover resource IDs if needed
wrangler d1 list ; wrangler kv namespace list
```

## Gotchas

- A temporary every-minute cron (`* * * * *`) was used to prove the refresh gate, then reverted to hourly (`0 * * * *`).
- The dashboard now has its **own** `dashboard/wrangler.toml` (`pages_build_output_dir = "dist"`), so deploy with `wrangler pages deploy` **from `dashboard/`** — it bundles `dist` + the `functions/` BFF and no longer prints "Ignoring configuration file."
- Pages Functions live in `dashboard/functions/` (BFF proxy). Validate they compile without deploying via `wrangler pages functions build dashboard/functions --outfile <tmp>` from the repo root.
- The reconcile CSV parser accepts `MM/DD/YYYY` and `YYYY-MM-DD` (a swapped month/day bug was found and fixed during Stage 3 testing).
