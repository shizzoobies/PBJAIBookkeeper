-- 0002_autopilot.sql
-- Autopilot marks the transactions it auto-approved (vs. human-approved) so the
-- dashboard can show them with an Undo and keep the human in control.
ALTER TABLE transactions ADD COLUMN auto_approved INTEGER NOT NULL DEFAULT 0;
