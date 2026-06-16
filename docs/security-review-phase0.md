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

## Deferred to Phase 1 (must address before production / real keys)

- **H1 — `/api/company` is unauthenticated** and triggers metered QBO reads. Gate behind the Access-protected dashboard BFF or a bearer/service-token before real keys.
- **H2 — `/oauth/connect` is unauthenticated.** Same gating; add per-IP rate limiting.
- **M1 (logs) — raw Intuit response bodies still reach Worker logs** via thrown error messages (kept verbose for sandbox debugging; redact before production).
- **M2 (full) — serialize per-realm refresh** with a KV/D1 lock or a Durable Object to eliminate the rotation race entirely (Phase 0 ships only the lightweight re-read mitigation above).
- **L1 — `/api/company` uses `realms[0]`**, not an authenticated principal; multi-tenant realm selection required in Phase 1.
- **L3 — OAuth callback errors render raw JSON**; redirect to a friendly dashboard error page.
- **L4 — `query()`'s SQL argument is a trust boundary**; build QBO queries from allow-listed fields, never concatenate untrusted input.

Full working notes (untracked): `.omc/research/phase0-review.md`.
