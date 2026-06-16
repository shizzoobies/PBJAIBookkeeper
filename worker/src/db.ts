import type { Env, RealmRow } from './types';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getRealm(env: Env, realmId: string): Promise<RealmRow | null> {
  return env.DB.prepare('SELECT * FROM realms WHERE realm_id = ?').bind(realmId).first<RealmRow>();
}

export async function listActiveRealms(env: Env): Promise<RealmRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM realms WHERE status = 'active'").all<RealmRow>();
  return results ?? [];
}

export interface ConnectParams {
  realmId: string;
  companyName: string | null;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessExpires: number;
}

export async function upsertRealmOnConnect(env: Env, p: ConnectParams): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO realms (realm_id, company_name, refresh_token, access_token, access_expires, status, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(realm_id) DO UPDATE SET
       company_name   = excluded.company_name,
       refresh_token  = excluded.refresh_token,
       access_token   = excluded.access_token,
       access_expires = excluded.access_expires,
       status         = 'active',
       updated_at     = excluded.updated_at`,
  )
    .bind(p.realmId, p.companyName, p.refreshTokenEnc, p.accessTokenEnc, p.accessExpires, now, now)
    .run();
}

export interface RefreshedTokens {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpires: number;
}

// Persist a rotated token set in a SINGLE statement so we never end up with a
// new access token stored alongside a stale refresh token (or vice versa).
// This is the spec's #1 failure point.
export async function persistRefreshedTokens(env: Env, realmId: string, t: RefreshedTokens): Promise<void> {
  await env.DB.prepare(
    `UPDATE realms
        SET access_token = ?, refresh_token = ?, access_expires = ?, status = 'active', updated_at = ?
      WHERE realm_id = ?`,
  )
    .bind(t.accessTokenEnc, t.refreshTokenEnc, t.accessExpires, nowSeconds(), realmId)
    .run();
}

export async function setRealmStatus(env: Env, realmId: string, status: RealmRow['status']): Promise<void> {
  await env.DB.prepare('UPDATE realms SET status = ?, updated_at = ? WHERE realm_id = ?')
    .bind(status, nowSeconds(), realmId)
    .run();
}

export interface AuditEntry {
  realm_id: string | null;
  actor: string;
  action: string;
  detail_json?: string | null;
}

export async function audit(env: Env, e: AuditEntry): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO audit_log (realm_id, actor, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(e.realm_id, e.actor, e.action, e.detail_json ?? null, nowSeconds())
    .run();
}
