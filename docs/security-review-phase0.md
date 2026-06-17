# Phase 0 — Security & Correctness Review

Independent review of the Phase 0 foundation (OAuth, token refresh, AES-GCM, D1, QBO query client).

## Verdict

**No CRITICAL issues.** The two highest-risk primitives are implemented correctly:

- **AES-GCM token encryption** — fresh random 12-byte IV per encryption, IV stored with the ciphertext, 32-byte key length validated, key imported non-extractable.
- **Atomic refresh-token rotation** — the rotated refresh token is persisted in a single `UPDATE`, so there is no window where a new access token sits beside a stale refresh token (the spec's #1 failure point).

The Phase 0 acceptance gate (connect sandbox company → unattended scheduled refresh → `SELECT * FROM CompanyInfo` returns data) is satisfied. Safe to run the sandbox smoke test.

## Fixed during Phase 0

- **Refresh race mitigation** — on an `invalid_grant`, the realm is re-read before being marked `reauth_needed`; if a concurrent refresh already persisted a fresh token, that token is used instead of forcing a reconnect.
- **Permanent-vs-transient classification** — `IntuitOAuthError.isPermanent()` keys on the `invalid_grant` error code, not any HTTP 400, so transient 400s no longer disable a realm.
- **Cron failure surfacing** — `runTokenRefreshSweep` audits and rethrows on a fatal (realm-list) failure; `scheduled()` logs sweep rejections instead of swallowing them.
- **Audit hygiene** — token-refresh failures persist `{ status, error }` (the parsed Intuit error code) to `audit_log`, never the raw Intuit response body.

## Fixed in Phase 1 hardening (2026-06-16)

- **H1 + H2 + CORS — the Worker is no longer publicly callable.** `/api/*` and `/oauth/connect` now require a fail-closed shared secret (`X-BFF-Secret`) held only by the dashboard's Pages Functions BFF (`dashboard/functions/`), which sits behind Cloudflare Access and proxies to the Worker. The SPA calls the BFF same-origin; the browser never reaches the Worker directly. Worker CORS is locked to `DASHBOARD_URL`. Gating connect behind Access supersedes the earlier per-IP rate-limit idea — and the `state` CSRF check still runs *before* any Intuit token exchange, so there is no unauthenticated outbound amplification. — `worker/src/index.ts` (`bffAuth`, cors), `dashboard/functions/*`.
- **M1 — raw Intuit/QBO bodies no longer reach logs/errors.** `IntuitOAuthError` keeps only status + parsed error code; `qbo.ts` query/report throw status-only; a redacting `onError` replaces default logging. — `worker/src/oauth.ts`, `worker/src/qbo.ts`, `worker/src/index.ts`.
- **L3 — OAuth callback no longer renders raw JSON.** It `try/catch`es the token exchange and redirects into the dashboard with `?connected=1` / `?error=connect_failed|connect_expired`. — `worker/src/oauth.ts`.

Independent review of the hardening diff found no CRITICAL/HIGH issues: the Worker is effectively unreachable without the secret, and the secret is never exposed to the browser (server-side only — set on the upstream request, absent from responses and the JS bundle).

## Still deferred (before production / real keys)

- **M2 (full) — serialize per-realm refresh** with a KV/D1 lock or a Durable Object to eliminate the rotation race entirely (today: the lightweight re-read mitigation). Low risk at single-realm + hourly cron.
- **L1 — multi-tenant realm selection.** The API still uses `realms[0]`, not an authenticated principal; required before connecting >1 company.
- **L4 — `query()`'s SQL argument is a trust boundary**; keep building QBO queries from allow-listed fields/literals, never concatenate untrusted input (today only fixed literals are used).
- **Belt-and-suspenders** — validate the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) inside the BFF, and rotate `BFF_SHARED_SECRET` periodically, before real keys.

Full working notes (untracked): `.omc/research/phase0-review.md`.
