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

export interface TransactionRow {
  id: number;
  realm_id: string;
  qbo_id: string;
  txn_type: string;
  txn_date: string;
  description: string | null;
  payee: string | null;
  amount: number;
  account_qbo_id: string | null;
  suggested_account: string | null;
  confidence: number | null;
  review_status: string;
  raw_json: string | null;
  updated_at: number;
}

export interface UpsertTxnParams {
  realmId: string;
  qboId: string;
  txnType: string;
  txnDate: string;
  description: string | null;
  payee: string | null;
  amount: number;
  accountQboId: string | null;
  rawJson: string;
}

// Upsert a synced transaction. On re-sync we refresh the QBO-side fields but
// preserve review_status / suggested_account / confidence (human + AI work).
export async function upsertTransaction(env: Env, t: UpsertTxnParams): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO transactions (realm_id, qbo_id, txn_type, txn_date, description, payee, amount, account_qbo_id, review_status, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(realm_id, qbo_id) DO UPDATE SET
       txn_date = excluded.txn_date,
       description = excluded.description,
       payee = excluded.payee,
       amount = excluded.amount,
       account_qbo_id = excluded.account_qbo_id,
       raw_json = excluded.raw_json,
       updated_at = excluded.updated_at`,
  )
    .bind(t.realmId, t.qboId, t.txnType, t.txnDate, t.description, t.payee, t.amount, t.accountQboId, t.rawJson, nowSeconds())
    .run();
}

export async function listTransactions(env: Env, realmId: string, status?: string): Promise<TransactionRow[]> {
  const stmt = status
    ? env.DB.prepare(
        'SELECT * FROM transactions WHERE realm_id = ? AND review_status = ? ORDER BY txn_date DESC, id DESC',
      ).bind(realmId, status)
    : env.DB.prepare('SELECT * FROM transactions WHERE realm_id = ? ORDER BY txn_date DESC, id DESC').bind(realmId);
  const { results } = await stmt.all<TransactionRow>();
  return results ?? [];
}

export interface RuleRow {
  id: number;
  realm_id: string | null;
  match_field: string;
  match_op: string;
  match_value: string;
  account_qbo_id: string;
  source: string;
  created_at: number;
}

// Realm-specific rules first, then global (realm_id IS NULL).
export async function listRules(env: Env, realmId: string): Promise<RuleRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM rules WHERE realm_id = ? OR realm_id IS NULL ORDER BY (realm_id IS NULL), id',
  )
    .bind(realmId)
    .all<RuleRow>();
  return results ?? [];
}

export interface InsertRuleParams {
  realmId: string | null;
  matchField: string;
  matchOp: string;
  matchValue: string;
  accountQboId: string;
  source: string;
}

export async function insertRule(env: Env, r: InsertRuleParams): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO rules (realm_id, match_field, match_op, match_value, account_qbo_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(r.realmId, r.matchField, r.matchOp, r.matchValue, r.accountQboId, r.source, nowSeconds())
    .run();
}

// Pending transactions that have no suggestion yet.
export async function listTransactionsNeedingCategorization(env: Env, realmId: string): Promise<TransactionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM transactions WHERE realm_id = ? AND review_status = 'pending' AND suggested_account IS NULL ORDER BY id",
  )
    .bind(realmId)
    .all<TransactionRow>();
  return results ?? [];
}

export async function setSuggestion(env: Env, id: number, suggestedAccount: string, confidence: number): Promise<void> {
  await env.DB.prepare('UPDATE transactions SET suggested_account = ?, confidence = ?, updated_at = ? WHERE id = ?')
    .bind(suggestedAccount, confidence, nowSeconds(), id)
    .run();
}

export async function getTransaction(env: Env, id: number, realmId: string): Promise<TransactionRow | null> {
  return env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND realm_id = ?').bind(id, realmId).first<TransactionRow>();
}

export async function approveTransaction(env: Env, id: number): Promise<void> {
  await env.DB.prepare("UPDATE transactions SET review_status = 'approved', updated_at = ? WHERE id = ?")
    .bind(nowSeconds(), id)
    .run();
}

// Human-corrected category: store it, mark adjusted, and treat it as ground truth.
export async function adjustTransaction(env: Env, id: number, accountQboId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE transactions SET account_qbo_id = ?, suggested_account = ?, confidence = 1.0, review_status = 'adjusted', updated_at = ? WHERE id = ?",
  )
    .bind(accountQboId, accountQboId, nowSeconds(), id)
    .run();
}
