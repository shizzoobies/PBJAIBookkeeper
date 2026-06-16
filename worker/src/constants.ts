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
