# AI Bookkeeper — Handoff / Resume Guide

_Last updated: 2026-06-16._ This is the cold-start guide: read `CLAUDE.md` (build spec) + `START_HERE.md` (setup) for full context, then this file for current state and what's next.

## Status at a glance

| Phase | State |
|---|---|
| **Phase 0 — Foundation** (OAuth, self-rotating token refresh, D1, QBO query) | ✅ **Done, gate passed** |
| **Phase 1 — Read / classify / reconcile / dashboard** | Stages 1–4 ✅ built & deployed · **Stage 5 remaining** |

**The only remaining work for the Phase 1 gate is Stage 5: put Cloudflare Access in front of the dashboard, then run the non-technical gate test.** Everything else is built, deployed, and proven on the QuickBooks sandbox.

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

**Secrets** (set via `wrangler secret put`; values live only in Cloudflare): `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY` — all set.

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

## ⏭️ NEXT — Stage 5 (needs the owner)

**1. Add Cloudflare Access to the dashboard.** Cloudflare **Zero Trust** dashboard → **Access → Applications → Add an application → Self-hosted**. Application domain: `ai-bookkeeper-dashboard.pages.dev`. Add a policy: **Action: Allow**, **Include → Emails →** `asoalexander@gmail.com` and `alex@mbsdoc.com`. Login method: **One-time PIN** (email link, no password, no IdP needed). (Zero Trust free plan is sufficient.)

**2. Non-technical gate test.** Open https://ai-bookkeeper-dashboard.pages.dev, log in via the email link, and confirm a non-technical user can, with no instructions:
- See the connected company + a "needs your review" count on Home.
- Open **Review**, see transactions with AI categories + a plain confidence signal, **approve** some and **adjust** one.
- Open **Reconciliation**, pick a period, upload a bank CSV, and read the three buckets + flags.
- Open **Reports** and load P&L / Balance Sheet.

A sample statement CSV for testing reconciliation lives in `.omc/recon-test.mjs` (gitignored) — it targets the May sandbox transactions.

## Phase 1 hardening backlog (before production / real keys)

Tracked in `docs/security-review-phase0.md`. The important ones:
- **H1/H2 + CORS:** the Worker's `/api/*` and `/oauth/connect` are **unauthenticated** and CORS is `*` (open). Acceptable for an isolated sandbox test; **must gate before real keys** — put the dashboard's API calls through an Access-authenticated path (service token / Pages Functions BFF) and restrict CORS to the Pages origin.
- **M1:** redact raw Intuit error bodies from Worker logs (audit log is already clean).
- **M2:** serialize per-realm token refresh with a lock (currently a lightweight re-read mitigation only).
- Write-back to QBO and Plaid ingestion are **out of scope** (Phase 2).

## Dev commands

```bash
# Worker
npm run typecheck
npm run deploy
npm run db:migrate:remote        # apply migrations to remote D1
wrangler tail                    # live logs
wrangler secret list             # confirm secrets (names only)

# Dashboard
cd dashboard && npm install && npm run build
wrangler pages deploy dashboard/dist --project-name=ai-bookkeeper-dashboard --commit-dirty=true

# Re-discover resource IDs if needed
wrangler d1 list ; wrangler kv namespace list
```

## Gotchas

- A temporary every-minute cron (`* * * * *`) was used to prove the refresh gate, then reverted to hourly (`0 * * * *`).
- `wrangler pages deploy` from the repo root prints "Ignoring configuration file" (it sees the Worker's `wrangler.toml`) — harmless; it still deploys `dashboard/dist`.
- The reconcile CSV parser accepts `MM/DD/YYYY` and `YYYY-MM-DD` (a swapped month/day bug was found and fixed during Stage 3 testing).
