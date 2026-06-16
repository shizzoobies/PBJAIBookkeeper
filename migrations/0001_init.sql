-- 0001_init.sql — AI Bookkeeper foundation schema (Phase 0)

-- One row per connected QBO company (realm).
CREATE TABLE IF NOT EXISTS realms (
  realm_id        TEXT PRIMARY KEY,                -- QBO company id
  company_name    TEXT,
  refresh_token   TEXT NOT NULL,                   -- AES-GCM encrypted
  access_token    TEXT,                            -- AES-GCM encrypted, short-lived
  access_expires  INTEGER,                         -- epoch seconds
  status          TEXT NOT NULL DEFAULT 'active',  -- active | reauth_needed | disconnected
  connected_at    INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Maps our records to QBO objects and tracks the SyncToken (QBO optimistic lock).
CREATE TABLE IF NOT EXISTS entity_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id      TEXT NOT NULL REFERENCES realms(realm_id),
  entity_type   TEXT NOT NULL,                     -- Invoice | Bill | Purchase | JournalEntry | Customer | Vendor | Account
  qbo_id        TEXT NOT NULL,
  sync_token    TEXT,                              -- refresh on every read; required on every update
  local_ref     TEXT,                              -- platform-side id when applicable
  updated_at    INTEGER NOT NULL,
  UNIQUE(realm_id, entity_type, qbo_id)
);

-- Cached posted transactions for categorization + reconciliation prep.
CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id          TEXT NOT NULL REFERENCES realms(realm_id),
  qbo_id            TEXT NOT NULL,
  txn_type          TEXT NOT NULL,                 -- Purchase | Deposit | etc.
  txn_date          TEXT NOT NULL,                 -- YYYY-MM-DD
  description       TEXT,
  payee             TEXT,
  amount            REAL NOT NULL,                 -- negative = money out
  account_qbo_id    TEXT,                          -- current categorization
  suggested_account TEXT,                          -- AI suggestion
  confidence        REAL,                          -- 0..1
  review_status     TEXT NOT NULL DEFAULT 'pending', -- pending | approved | adjusted
  raw_json          TEXT,
  updated_at        INTEGER NOT NULL,
  UNIQUE(realm_id, qbo_id)
);

-- Deterministic categorization rules, learned from human corrections.
CREATE TABLE IF NOT EXISTS rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id       TEXT,                             -- NULL = applies to all realms
  match_field    TEXT NOT NULL,                    -- payee | description
  match_op       TEXT NOT NULL,                    -- contains | equals | regex
  match_value    TEXT NOT NULL,
  account_qbo_id TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'human',    -- human | seed
  created_at     INTEGER NOT NULL
);

-- Immutable audit log of every automated action (also feeds the assessment later).
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id     TEXT,
  actor        TEXT NOT NULL,                      -- system | <user email>
  action       TEXT NOT NULL,
  detail_json  TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_realm_status ON transactions(realm_id, review_status);
CREATE INDEX IF NOT EXISTS idx_entity_map_realm_type     ON entity_map(realm_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_rules_realm               ON rules(realm_id);
CREATE INDEX IF NOT EXISTS idx_audit_realm_created       ON audit_log(realm_id, created_at);
