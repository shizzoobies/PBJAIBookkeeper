import type { Env, RealmRow, IntuitTokenResponse } from './types';
import { apiBase, QBO_MINOR_VERSION, ACCESS_TOKEN_SKEW_SECONDS } from './constants';
import { decryptToken, encryptToken } from './crypto';
import { refreshTokens, IntuitOAuthError } from './oauth';
import { persistRefreshedTokens, setRealmStatus, audit, getRealm } from './db';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Refresh the access token, persist the (possibly rotated) refresh token in a
// single statement, and return the new access token. On a permanent auth
// failure the realm is marked reauth_needed; transient failures leave it active
// so the next sweep retries.
export async function refreshRealmTokens(env: Env, realm: RealmRow): Promise<string> {
  const currentRefresh = await decryptToken(realm.refresh_token, env.TOKEN_ENC_KEY);

  let tok: IntuitTokenResponse;
  try {
    tok = await refreshTokens(env, currentRefresh);
  } catch (err) {
    const permanent = err instanceof IntuitOAuthError && err.isPermanent();
    if (permanent) {
      // A concurrent refresh may have already rotated the token and invalidated
      // the one we just sent. Re-read before declaring the realm dead.
      const current = await getRealm(env, realm.realm_id);
      if (
        current?.access_token &&
        current.access_expires !== null &&
        current.access_expires - nowSeconds() > ACCESS_TOKEN_SKEW_SECONDS
      ) {
        await audit(env, {
          realm_id: realm.realm_id,
          actor: 'system',
          action: 'token_refresh_raced',
          detail_json: null,
        });
        return decryptToken(current.access_token, env.TOKEN_ENC_KEY);
      }
      await setRealmStatus(env, realm.realm_id, 'reauth_needed');
    }
    await audit(env, {
      realm_id: realm.realm_id,
      actor: 'system',
      action: permanent ? 'token_reauth_needed' : 'token_refresh_failed',
      detail_json: JSON.stringify(
        err instanceof IntuitOAuthError
          ? { status: err.status, error: err.errorCode }
          : { error: 'network_or_unknown' },
      ),
    });
    throw err;
  }

  const [accessTokenEnc, refreshTokenEnc] = await Promise.all([
    encryptToken(tok.access_token, env.TOKEN_ENC_KEY),
    encryptToken(tok.refresh_token, env.TOKEN_ENC_KEY),
  ]);
  await persistRefreshedTokens(env, realm.realm_id, {
    accessTokenEnc,
    refreshTokenEnc,
    accessExpires: nowSeconds() + tok.expires_in,
  });
  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'token_refreshed',
    detail_json: JSON.stringify({ rotated: tok.refresh_token !== currentRefresh }),
  });
  return tok.access_token;
}

export async function getValidAccessToken(env: Env, realm: RealmRow): Promise<string> {
  if (
    realm.access_token &&
    realm.access_expires !== null &&
    realm.access_expires - nowSeconds() > ACCESS_TOKEN_SKEW_SECONDS
  ) {
    return decryptToken(realm.access_token, env.TOKEN_ENC_KEY);
  }
  return refreshRealmTokens(env, realm);
}

export async function query<T = unknown>(env: Env, realm: RealmRow, sql: string): Promise<T> {
  const accessToken = await getValidAccessToken(env, realm);
  const url = `${apiBase(env)}/v3/company/${realm.realm_id}/query?query=${encodeURIComponent(sql)}&minorversion=${QBO_MINOR_VERSION}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`QBO query failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}
