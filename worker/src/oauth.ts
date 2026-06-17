import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, IntuitTokenResponse } from './types';
import { INTUIT_AUTH_URL, INTUIT_TOKEN_URL, QBO_SCOPE, QBO_MINOR_VERSION, apiBase } from './constants';
import { encryptToken } from './crypto';
import { upsertRealmOnConnect, audit } from './db';

const OAUTH_STATE_TTL_SECONDS = 600;
const STATE_PREFIX = 'oauth_state:';

// Error from the Intuit token endpoint. Stores only the HTTP status and the
// parsed error code — never the raw response body — so nothing sensitive can
// reach logs (M1). It still carries enough to tell a permanent auth failure
// (invalid_grant) from a transient one.
export class IntuitOAuthError extends Error {
  readonly status: number;
  readonly errorCode: string;
  constructor(status: number, body: string) {
    const errorCode = IntuitOAuthError.parseErrorCode(body);
    super(`Intuit token request failed (status ${status}, error ${errorCode})`);
    this.name = 'IntuitOAuthError';
    this.status = status;
    this.errorCode = errorCode;
  }
  isPermanent(): boolean {
    // The refresh token is no longer valid (expired/revoked) — re-auth required.
    return this.errorCode === 'invalid_grant';
  }
  // Intuit error code parsed from the response body (e.g. 'invalid_grant').
  private static parseErrorCode(body: string): string {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      return typeof parsed.error === 'string' ? parsed.error : 'unknown';
    } catch {
      return 'unparseable';
    }
  }
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<IntuitTokenResponse> {
  const basic = btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw new IntuitOAuthError(res.status, await res.text());
  }
  return (await res.json()) as IntuitTokenResponse;
}

export function exchangeCodeForTokens(env: Env, code: string): Promise<IntuitTokenResponse> {
  return tokenRequest(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.QBO_REDIRECT_URI,
  });
}

export function refreshTokens(env: Env, refreshToken: string): Promise<IntuitTokenResponse> {
  return tokenRequest(env, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

async function fetchCompanyName(env: Env, realmId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiBase(env)}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${QBO_MINOR_VERSION}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { CompanyInfo?: { CompanyName?: string } };
    return json.CompanyInfo?.CompanyName ?? null;
  } catch {
    return null; // company name is best-effort; never block the connection on it
  }
}

export const handleConnect = async (c: Context<{ Bindings: Env }>) => {
  const state = randomHex(24);
  await c.env.COA_CACHE.put(STATE_PREFIX + state, '1', { expirationTtl: OAUTH_STATE_TTL_SECONDS });

  const url = new URL(INTUIT_AUTH_URL);
  url.searchParams.set('client_id', c.env.QBO_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', QBO_SCOPE);
  url.searchParams.set('redirect_uri', c.env.QBO_REDIRECT_URI);
  url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
};

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  realmId: z.string().min(1),
});

// Absolute URL back into the dashboard UI. Falls back to a relative path
// (Worker origin) if DASHBOARD_URL isn't configured.
function dashboardUrl(env: Env, path: string): string {
  const base = env.DASHBOARD_URL?.replace(/\/+$/, '') ?? '';
  return `${base}${path}`;
}

export const handleCallback = async (c: Context<{ Bindings: Env }>) => {
  const parsed = callbackSchema.safeParse({
    code: c.req.query('code'),
    state: c.req.query('state'),
    realmId: c.req.query('realmId'),
  });
  if (!parsed.success) {
    // L3: redirect into the UI with a friendly code instead of raw JSON.
    return c.redirect(dashboardUrl(c.env, '/?error=connect_failed'), 302);
  }
  const { code, state, realmId } = parsed.data;

  // CSRF: the returned state must match one we issued.
  const stateKey = STATE_PREFIX + state;
  const known = await c.env.COA_CACHE.get(stateKey);
  if (!known) return c.redirect(dashboardUrl(c.env, '/?error=connect_expired'), 302);
  await c.env.COA_CACHE.delete(stateKey);

  let tok: IntuitTokenResponse;
  try {
    tok = await exchangeCodeForTokens(c.env, code);
  } catch (err) {
    // L3 + M1: audit only the parsed error code, never the raw body; send the
    // user back to a friendly error state.
    await audit(c.env, {
      realm_id: realmId,
      actor: 'system',
      action: 'company_connect_failed',
      detail_json: JSON.stringify(
        err instanceof IntuitOAuthError
          ? { status: err.status, error: err.errorCode }
          : { error: 'network_or_unknown' },
      ),
    });
    return c.redirect(dashboardUrl(c.env, '/?error=connect_failed'), 302);
  }
  const now = Math.floor(Date.now() / 1000);

  const [accessTokenEnc, refreshTokenEnc, companyName] = await Promise.all([
    encryptToken(tok.access_token, c.env.TOKEN_ENC_KEY),
    encryptToken(tok.refresh_token, c.env.TOKEN_ENC_KEY),
    fetchCompanyName(c.env, realmId, tok.access_token),
  ]);

  await upsertRealmOnConnect(c.env, {
    realmId,
    companyName,
    refreshTokenEnc,
    accessTokenEnc,
    accessExpires: now + tok.expires_in,
  });
  await audit(c.env, {
    realm_id: realmId,
    actor: 'system',
    action: 'company_connected',
    detail_json: JSON.stringify({ companyName }),
  });

  return c.redirect(dashboardUrl(c.env, '/?connected=1'), 302);
};
