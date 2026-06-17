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
    // M1: never echo the raw Intuit response body into logs/errors.
    throw new Error(`QBO query failed (status ${res.status})`);
  }
  return (await res.json()) as T;
}

interface QboQueryResponse<T> {
  QueryResponse?: Record<string, T[] | number>;
}

// Paginated query over a QBO entity (e.g. 'Account', 'Purchase'). `fromEntity`
// is a fixed entity name from our code, never user input.
export async function queryAll<T = unknown>(env: Env, realm: RealmRow, fromEntity: string): Promise<T[]> {
  const pageSize = 100;
  let start = 1;
  const all: T[] = [];
  for (;;) {
    const sql = `SELECT * FROM ${fromEntity} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const res = await query<QboQueryResponse<T>>(env, realm, sql);
    const block = res.QueryResponse?.[fromEntity];
    const page = Array.isArray(block) ? block : [];
    all.push(...page);
    if (page.length < pageSize) break;
    start += pageSize;
  }
  return all;
}

// QBO report (e.g. 'ProfitAndLoss', 'BalanceSheet'). reportName is a fixed string
// from our code; params (start_date/end_date) are caller-supplied.
export async function report<T = unknown>(
  env: Env,
  realm: RealmRow,
  reportName: string,
  params: Record<string, string>,
): Promise<T> {
  const token = await getValidAccessToken(env, realm);
  const qs = new URLSearchParams({ ...params, minorversion: QBO_MINOR_VERSION }).toString();
  const url = `${apiBase(env)}/v3/company/${realm.realm_id}/reports/${reportName}?${qs}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    // M1: never echo the raw Intuit response body into logs/errors.
    throw new Error(`QBO report ${reportName} failed (status ${res.status})`);
  }
  return (await res.json()) as T;
}

// Create a QBO entity (e.g. 'bill', 'purchase', 'vendor'). Writes are free under
// the read-credit meter. `entity` is a fixed name from our code, never user input.
export async function createEntity<T = unknown>(
  env: Env,
  realm: RealmRow,
  entity: string,
  body: unknown,
): Promise<T> {
  const token = await getValidAccessToken(env, realm);
  const url = `${apiBase(env)}/v3/company/${realm.realm_id}/${entity}?minorversion=${QBO_MINOR_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`QBO create ${entity} failed (status ${res.status})`);
  }
  return (await res.json()) as T;
}

// Upload a file and attach it to a transaction via QBO's /upload endpoint:
// multipart with a JSON metadata part (carrying the AttachableRef link) and the
// binary content part, sharing the same index suffix.
export async function uploadAttachment(
  env: Env,
  realm: RealmRow,
  args: { entityType: string; entityId: string; fileName: string; contentType: string; bytes: ArrayBuffer },
): Promise<void> {
  const token = await getValidAccessToken(env, realm);
  const metadata = {
    AttachableRef: [{ EntityRef: { type: args.entityType, value: args.entityId } }],
    FileName: args.fileName,
    ContentType: args.contentType,
  };
  const form = new FormData();
  form.append('file_metadata_0', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
  form.append('file_content_0', new Blob([args.bytes], { type: args.contentType }), args.fileName);

  const url = `${apiBase(env)}/v3/company/${realm.realm_id}/upload?minorversion=${QBO_MINOR_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: form, // runtime sets multipart/form-data + boundary
  });
  if (!res.ok) {
    throw new Error(`QBO attachment upload failed (status ${res.status})`);
  }
}
