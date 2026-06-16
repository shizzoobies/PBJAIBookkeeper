import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, IntuitTokenResponse } from './types';
import { INTUIT_AUTH_URL, INTUIT_TOKEN_URL, QBO_SCOPE, QBO_MINOR_VERSION, apiBase } from './constants';
import { encryptToken } from './crypto';
import { upsertRealmOnConnect, audit } from './db';

const OAUTH_STATE_TTL_SECONDS = 600;
const STATE_PREFIX = 'oauth_state:';

// Error from the Intuit token endpoint, carrying enough to tell a permanent
// auth failure (invalid_grant) from a transient one.
export class IntuitOAuthError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Intuit token request failed (${status}): ${body}`);
    this.name = 'IntuitOAuthError';
    this.status = status;
    this.body = body;
  }
  isPermanent(): boolean {
    // The refresh token is no longer valid (expired/revoked) — re-auth required.
    return this.errorCode === 'invalid_grant';
  }
  // Intuit error code parsed from the response body (e.g. 'invalid_grant').
  get errorCode(): string {
    try {
      const parsed = JSON.parse(this.body) as { error?: unknown };
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

export const handleCallback = async (c: Context<{ Bindings: Env }>) => {
  const parsed = callbackSchema.safeParse({
    code: c.req.query('code'),
    state: c.req.query('state'),
    realmId: c.req.query('realmId'),
  });
  if (!parsed.success) {
    const providerError = c.req.query('error');
    return c.json({ error: 'invalid_callback', detail: providerError ?? 'missing code/state/realmId' }, 400);
  }
  const { code, state, realmId } = parsed.data;

  // CSRF: the returned state must match one we issued.
  const stateKey = STATE_PREFIX + state;
  const known = await c.env.COA_CACHE.get(stateKey);
  if (!known) return c.json({ error: 'invalid_state' }, 400);
  await c.env.COA_CACHE.delete(stateKey);

  const tok = await exchangeCodeForTokens(c.env, code);
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

  return c.redirect('/?connected=1', 302);
};
