# AI Bookkeeper (Test Build) — Claude Code Handoff

> Project brief and build spec. Drop this in the repo root as `CLAUDE.md`.
> Audience: Claude Code (build instructions) plus a human runbook for the project owner at the end.
> Stack: GitHub + Cloudflare (Workers, D1, Pages, Queues, Cron, Workers Secrets).

---

## 0. What we are building and why

A multi-tenant "AI bookkeeper" for an accounting firm with ~50 clients. This repo is the **test build**: prove the full loop against the QuickBooks Online **sandbox** before any real client books are touched.

The loop to prove:

1. Connect a QuickBooks Online company via OAuth.
2. Pull its posted transactions and chart of accounts.
3. Auto-categorize transactions (rules first, Claude for the remainder, confidence-gated).
4. Generate a reconciliation prep view (matches, exceptions, uncleared items).
5. Present all of it in a dashboard a **non-technical** firm staffer can use without training.

When the test loop works on sandbox, the same engine scales to production and 50 client connections. That is a later phase, not this one.

---

## 1. Hard constraints (do not violate, do not try to work around)

These are QuickBooks Online API realities. Building around them is the whole point.

- **The bank "For Review" feed is NOT accessible via the API.** Do not attempt to read, categorize, or post to the bank-feed review queue. Work only with **posted** transactions, and with transactions we write ourselves.
- **The reconcile-and-lock action is NOT exposed.** We automate reconciliation *prep and exception detection*. A human performs the final reconcile click in QBO. The dashboard makes that handoff clean; it does not pretend to complete the reconciliation.
- **Bank rules are NOT configurable via API.** Ignore them.
- **Reads are metered, writes are free.** Under the Intuit App Partner Program Builder tier there is a monthly read-credit allotment, and overage is *blocked*, not billed. So: **never poll.** Cache the chart of accounts. Use webhooks/Change Data Capture for change notifications. Pull reads on demand or on schedule, not in loops.
- **This build is SANDBOX ONLY.** No production keys, no real client data. Production access requires Intuit's app assessment, which runs on a separate track.

---

## 2. Architecture

```
GitHub repo (mono)
│
├── Cloudflare Pages  ........  dashboard (static SPA + Pages Functions for BFF)
│        guarded by Cloudflare Access (email login, no passwords for the client)
│
└── Cloudflare Worker  .......  api service
         ├── /oauth/*         OAuth connect + callback + token exchange
         ├── /api/*           dashboard data endpoints (BFF calls these)
         ├── /webhook/qbo     Intuit Change Data Capture receiver
         ├── Cron Trigger     refresh tokens before expiry; nightly sync
         └── Queue consumer   async sync + categorization jobs
                │
                ├── D1          relational store (tokens, mappings, cache, rules, audit)
                ├── KV          short-lived cache (COA, rate-limit counters)
                └── Anthropic API   categorization (server-side, key in Secrets)
```

Single Worker for the API is fine at test scale. Keep the dashboard as a Pages app that talks to the Worker. Put **Cloudflare Access** in front of the dashboard so the non-technical client logs in by email link with zero password management and we own no auth code.

---

## 3. Tech stack and repo layout

- **Language:** TypeScript throughout.
- **Worker framework:** Hono (clean routing on Workers).
- **Dashboard:** Vite + React + TypeScript, deployed to Pages. Tailwind for styling. Keep it light; this is a tool, not a marketing site.
- **DB:** Cloudflare D1 (SQLite). Use Drizzle ORM or plain prepared statements; pick one and be consistent.
- **Validation:** Zod on every external input (OAuth callback params, webhook payloads, dashboard requests).
- **Crypto:** WebCrypto (AES-GCM) for token encryption at rest.

```
/
├── CLAUDE.md                 (this file)
├── README.md
├── wrangler.toml             (Worker + bindings)
├── /worker
│   ├── src/index.ts          (Hono app entry, route mounting)
│   ├── src/oauth.ts          (connect, callback, token exchange + refresh)
│   ├── src/qbo.ts            (QBO API client: query, read entities, write entities)
│   ├── src/crypto.ts         (encrypt/decrypt refresh tokens)
│   ├── src/categorize.ts     (rules engine + Claude classifier)
│   ├── src/reconcile.ts      (matching + exception detection)
│   ├── src/sync.ts           (pull posted txns + COA, write to D1)
│   ├── src/webhook.ts        (CDC receiver)
│   ├── src/cron.ts           (token refresh + scheduled sync)
│   └── src/db.ts             (D1 helpers / schema access)
├── /dashboard
│   ├── src/                  (React app)
│   └── ...
├── /migrations               (D1 SQL migrations)
└── /shared                   (types shared by worker + dashboard)
```

---

## 4. Data model (D1)

Write these as numbered migrations in `/migrations`.

```sql
-- 0001_init.sql

-- One row per connected QBO company (realm).
CREATE TABLE realms (
  realm_id        TEXT PRIMARY KEY,        -- QBO company id
  company_name    TEXT,
  refresh_token   TEXT NOT NULL,           -- AES-GCM encrypted
  access_token    TEXT,                    -- AES-GCM encrypted, short-lived
  access_expires  INTEGER,                 -- epoch seconds
  status          TEXT NOT NULL DEFAULT 'active', -- active | reauth_needed | disconnected
  connected_at    INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Maps our records to QBO objects and tracks the SyncToken (QBO optimistic lock).
CREATE TABLE entity_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id      TEXT NOT NULL REFERENCES realms(realm_id),
  entity_type   TEXT NOT NULL,             -- Invoice | Bill | Purchase | JournalEntry | Customer | Vendor | Account
  qbo_id        TEXT NOT NULL,
  sync_token    TEXT,                      -- refresh on every read; required on every update
  local_ref     TEXT,                      -- platform-side id when applicable
  updated_at    INTEGER NOT NULL,
  UNIQUE(realm_id, entity_type, qbo_id)
);

-- Cached posted transactions for categorization + reconciliation prep.
CREATE TABLE transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id      TEXT NOT NULL REFERENCES realms(realm_id),
  qbo_id        TEXT NOT NULL,
  txn_type      TEXT NOT NULL,             -- Purchase | Deposit | etc.
  txn_date      TEXT NOT NULL,             -- YYYY-MM-DD
  description   TEXT,
  payee         TEXT,
  amount        REAL NOT NULL,             -- negative = money out
  account_qbo_id TEXT,                     -- current categorization
  suggested_account TEXT,                  -- AI suggestion
  confidence    REAL,                      -- 0..1
  review_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | adjusted
  raw_json      TEXT,
  updated_at    INTEGER NOT NULL,
  UNIQUE(realm_id, qbo_id)
);

-- Deterministic categorization rules, learned from human corrections.
CREATE TABLE rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id      TEXT,                      -- NULL = applies to all realms
  match_field   TEXT NOT NULL,             -- payee | description
  match_op      TEXT NOT NULL,             -- contains | equals | regex
  match_value   TEXT NOT NULL,
  account_qbo_id TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'human', -- human | seed
  created_at    INTEGER NOT NULL
);

-- Immutable audit log of every automated action (also feeds the assessment later).
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id      TEXT,
  actor         TEXT NOT NULL,             -- system | <user email>
  action        TEXT NOT NULL,
  detail_json   TEXT,
  created_at    INTEGER NOT NULL
);
```

Store the chart of accounts in **KV** keyed by realm (`coa:<realm_id>`), refreshed on connect and on COA change webhooks, so categorization does not burn a read per transaction.

---

## 5. Secrets and config

Set via `wrangler secret put` (never commit):

| Secret | Purpose |
|---|---|
| `QBO_CLIENT_ID` | Intuit app client id (sandbox) |
| `QBO_CLIENT_SECRET` | Intuit app client secret (sandbox) |
| `QBO_REDIRECT_URI` | `https://<worker-domain>/oauth/callback` |
| `QBO_WEBHOOK_VERIFIER` | Intuit webhook verifier token |
| `TOKEN_ENC_KEY` | 32-byte base64 key for AES-GCM token encryption |
| `ANTHROPIC_API_KEY` | server-side categorization |

`wrangler.toml` declares bindings: D1 database, KV namespace, Queue (producer + consumer), and the Cron Trigger schedule. Base URL for sandbox API calls: `https://sandbox-quickbooks.api.intuit.com`.

---

## 6. Build phases and acceptance criteria

Build in order. Each phase has a hard acceptance gate; do not advance until it passes.

### Phase 0 — Foundation
- OAuth connect flow: `/oauth/connect` redirects to Intuit; `/oauth/callback` exchanges the code, captures `realmId`, encrypts and stores tokens in `realms`.
- Token refresh: a function that refreshes the access token using the refresh token, **persists the rotated refresh token atomically** (this is the #1 failure point), and a Cron Trigger that refreshes any token nearing expiry.
- QBO client (`qbo.ts`) with a `query()` helper hitting `/v3/company/{realmId}/query`.
- D1 migrations applied.

**Gate:** connect the sandbox company, then a scheduled run refreshes its token without manual help, and `query("SELECT * FROM CompanyInfo")` returns data.

### Phase 1 — Read, classify, reconcile prep, dashboard
- Sync: pull posted transactions + COA for the connected realm into D1/KV (`sync.ts`).
- Categorization engine (`categorize.ts`, see section 7).
- Reconciliation prep (`reconcile.ts`, see section 8).
- Dashboard (see section 9): connect screen, review queue, reconciliation view, simple report view.
- Approving or adjusting a category writes a new `rules` row so the engine compounds.

**Gate:** a non-technical tester, given only the dashboard URL, can log in, see categorized transactions with confidence, approve/adjust them, and open a reconciliation view that clearly lists matches and exceptions, without asking how.

> Out of scope for this test: writing transactions back to QBO, production keys, multi-realm at 50 connections, Plaid ingestion, payroll. Stub the write path behind a feature flag but do not enable it.

---

## 7. Categorization engine

Layered, cheapest first:

1. **Rules pass.** Check each pending transaction against `rules` (realm-specific first, then global). A match assigns the account at confidence 1.0.
2. **Claude pass** for the remainder. Batch the unmatched transactions and call the Anthropic **Messages API** server-side from the Worker.
   - Use a fast classification model (`claude-haiku-4-5-20251001`). Verify the current model string and `anthropic-version` header against https://docs.claude.com/en/api/overview at build time.
   - Headers: `x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
   - Prompt: pass the transaction (payee, description, amount, date) plus the realm's chart of accounts (account names + ids from KV). Instruct the model to return **only JSON**: `[{ "qbo_id": "...", "account_qbo_id": "...", "confidence": 0.0-1.0 }]`. Parse defensively (strip code fences, try/catch).
3. **Confidence gate.** Write `suggested_account` and `confidence`. Above the threshold (start at 0.85) mark ready for one-click approval; below it, flag for manual attention. Never auto-finalize; a human always approves in this test.
4. **Learning.** When a human adjusts a category, insert a `rules` row from that correction so the same payee is deterministic next time.

Keep all Claude calls server-side. The API key never reaches the browser.

---

## 8. Reconciliation prep engine

The labor we remove, short of the final lock:

- Pull posted transactions for the selected period.
- Match against a provided statement dataset (for the test, accept an uploaded CSV of bank lines; production will swap in Plaid). Match on date proximity + amount + payee similarity.
- Produce three buckets: **matched**, **on the books but not on the statement**, **on the statement but not on the books**.
- Flag **duplicates** (same amount/date/payee posted twice) and **stale uncleared** items (outstanding beyond a threshold).
- Output a reconciliation worksheet object the dashboard renders and can export.
- End state is a clean handoff: "here is what ties, here is what does not, here is what to fix," then the human does the reconcile-and-lock in QBO.

---

## 9. Dashboard (built for a non-technical user)

This is the part the client actually touches, so it carries the most care. Design rules:

- **Plain language, no system or accounting jargon.** Say "Needs your review," not "Pending categorization." Say "Doesn't match the bank," not "Unreconciled variance." Never expose realm ids, SyncTokens, or API terms.
- **One obvious next action per screen.** Active-voice buttons: "Review," "Approve," "Approve all high-confidence," "Export."
- **Confidence shown as plain signal,** not a decimal. "Sure" / "Likely" / "Needs a look," color-coded, with the AI's suggested category prefilled and editable.
- **Empty and done states guide,** not decorate: "All caught up. Nothing needs review right now."
- **Quality floor:** responsive to mobile, visible keyboard focus, reduced-motion respected.

Screens for the test:

1. **Home / connect.** If no company connected: a single "Connect QuickBooks" button. If connected: company name + a tile per task ("12 need review," "Reconciliation ready").
2. **Review queue.** Table of transactions with AI category prefilled, plain confidence signal, inline edit, per-row Approve, and a bulk "Approve all high-confidence." Approving updates `review_status` and (on adjust) writes a rule.
3. **Reconciliation.** Period picker, statement CSV upload, then the three buckets and the flags in clear sections with counts. An "Export worksheet" button.
4. **Reports.** Pull and display P&L / Balance Sheet for the period, with a download. Read-disciplined: fetch on request, cache briefly.

Login is handled by Cloudflare Access in front of Pages. The user sees an email-link login, nothing to manage.

---

## 10. Security

- Encrypt `refresh_token` and `access_token` at rest with AES-GCM (`TOKEN_ENC_KEY` in Secrets). Decrypt only in-Worker, in-memory.
- Verify the Intuit webhook signature against `QBO_WEBHOOK_VERIFIER` on every `/webhook/qbo` call.
- Validate every inbound payload with Zod.
- Log every automated action to `audit_log`. This doubles as evidence for the production assessment later.
- No secrets in the repo, in client code, or in logs.

---

## 11. Runbook for the owner (the manual steps Claude Code cannot do)

Do these in order. The first block needs no approvals and gets you building today.

**A. Intuit setup (sandbox)**
1. Create a free account at developer.intuit.com.
2. Create an app, select the **QuickBooks Online Accounting API**. Note who owns this account; for production it should belong to the firm, but for the test your own account is fine.
3. From the app's **Keys & credentials**, copy the **sandbox** Client ID and Client Secret.
4. In the app settings, add the redirect URI: `https://<your-worker-subdomain>.workers.dev/oauth/callback`. You will know the exact subdomain after step C; come back and set it.
5. Confirm you have a sandbox company (the portal creates one automatically under "Sandboxes").

**B. Cloudflare setup**
1. Create a Cloudflare account if you do not have one. Install Wrangler: `npm i -g wrangler`, then `wrangler login`.
2. Create the D1 database: `wrangler d1 create ai-bookkeeper`. Paste the binding it prints into `wrangler.toml`.
3. Create a KV namespace: `wrangler kv namespace create COA_CACHE`. Paste the binding in.
4. Create a Queue: `wrangler queues create bookkeeper-jobs`.

**C. Repo + deploy**
1. Create a new GitHub repo, clone it, drop this file in as `CLAUDE.md`.
2. Hand the repo to Claude Code and have it build Phase 0 against this spec.
3. Deploy the Worker: `wrangler deploy`. Note the `*.workers.dev` URL, then go back to Intuit step A4 and set the redirect URI to match.
4. Set secrets: run `wrangler secret put` for each entry in section 5. Generate `TOKEN_ENC_KEY` with `openssl rand -base64 32`.
5. Deploy the dashboard to Pages (connect the GitHub repo in the Cloudflare dashboard, build dir `/dashboard`).
6. Turn on **Cloudflare Access** for the Pages project: add your own email (and a test client email) as the allowed users.

**D. Prove the loop**
1. Open the dashboard, click Connect QuickBooks, authorize the **sandbox** company.
2. Confirm transactions appear, categorized, in the review queue.
3. Approve a few, adjust one, confirm the adjustment sticks (a rule was written).
4. Upload a sample bank CSV in Reconciliation, confirm the three buckets populate.

When D passes, the test build is done and the engine is proven.

---

## 12. Definition of done (test)

- A sandbox company connects via OAuth and stays connected across token refreshes with no manual intervention.
- Posted transactions sync into D1 and appear categorized with a confidence signal.
- A non-technical tester completes review and reconciliation prep using only the dashboard.
- Every automated action is in `audit_log`.
- No production keys, no real client data, no attempt to touch the bank-feed review queue or the reconcile-and-lock action.
