import type { RealmStatus } from '../../shared/types';

export interface Env {
  // Bindings (wrangler.toml)
  DB: D1Database;
  COA_CACHE: KVNamespace;

  // Secrets (wrangler secret put / .dev.vars)
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_REDIRECT_URI: string;
  TOKEN_ENC_KEY: string;
  QBO_WEBHOOK_VERIFIER?: string; // Phase 1
  ANTHROPIC_API_KEY?: string; // Phase 1
  BFF_SHARED_SECRET?: string; // Phase 1 hardening: secret the Pages BFF must present on /api/* + /oauth/connect

  // Vars (wrangler.toml [vars])
  QBO_ENVIRONMENT: string; // 'sandbox' | 'production'
  REFRESH_WINDOW_SECONDS?: string;
  DASHBOARD_URL?: string; // Pages origin — CORS scope + OAuth redirect target
}

// Row shape of the `realms` table.
export interface RealmRow {
  realm_id: string;
  company_name: string | null;
  refresh_token: string; // AES-GCM encrypted
  access_token: string | null; // AES-GCM encrypted
  access_expires: number | null; // epoch seconds
  status: RealmStatus;
  connected_at: number;
  updated_at: number;
}

// Intuit OAuth token endpoint response.
export interface IntuitTokenResponse {
  token_type: string;
  expires_in: number; // access token lifetime (seconds)
  access_token: string;
  refresh_token: string;
  x_refresh_token_expires_in: number; // refresh token lifetime (seconds)
}
