import type { Env } from './types';

// Intuit OAuth endpoints are shared across sandbox and production; the
// environment is determined by which keys are used and which API base is hit.
export const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
export const QBO_MINOR_VERSION = '73';

// Refresh the access token if it expires within this many seconds (on-demand path).
export const ACCESS_TOKEN_SKEW_SECONDS = 300;

const DEFAULT_REFRESH_WINDOW_SECONDS = 3600;

export function apiBase(env: Env): string {
  return env.QBO_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Cron sweep refreshes any token expiring within this window (from [vars]).
export function refreshWindowSeconds(env: Env): number {
  const v = Number(env.REFRESH_WINDOW_SECONDS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_REFRESH_WINDOW_SECONDS;
}

// ---- Categorization (Phase 1) ----
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
// Fast classification model (spec §7), verified against the Claude API reference.
export const CLASSIFIER_MODEL = 'claude-haiku-4-5';
// Document-extraction model for receipt/bill capture (image vision + PDF). Haiku
// 4.5 supports vision; verified against the Claude API reference. Swap to a larger
// model here if messy bills need it.
export const EXTRACT_MODEL = 'claude-haiku-4-5';
// At/above this confidence a suggestion is "ready for one-click approval";
// below it, it needs a closer look. A human always approves in this test build.
export const CONFIDENCE_THRESHOLD = 0.85;
// Transactions per Claude classification request.
export const CLASSIFY_BATCH_SIZE = 25;
