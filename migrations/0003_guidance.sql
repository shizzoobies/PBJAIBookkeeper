-- 0003_guidance.sql
-- "Teach" guidance: plain-language notes (optionally pinned to a vendor and a
-- preferred account) that are fed into the AI categorizer so it understands the
-- firm's intent. Softer than a rule — it shapes the AI's judgment rather than
-- forcing an exact match.
CREATE TABLE guidance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  realm_id       TEXT NOT NULL,
  vendor         TEXT,           -- optional: pin to a vendor/payee
  account_qbo_id TEXT,           -- optional: the preferred category
  note           TEXT NOT NULL,  -- the "why" / instruction
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_guidance_realm ON guidance(realm_id);
