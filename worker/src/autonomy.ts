import type { Env, RealmRow } from './types';
import type { CoaEntry } from './sync';
import {
  listTransactions,
  listRules,
  listApprovedPayees,
  approveTransactionAuto,
  audit,
  type TransactionRow,
} from './db';

// Plain-language guardrails the user controls. Off by default — opt-in.
export interface AutonomyConfig {
  enabled: boolean;
  minConfidence: number; // only auto-approve at/above this confidence
  maxAmount: number; // skip anything larger than this (absolute dollars)
  requireKnownVendor: boolean; // escalate vendors we haven't reviewed before
}

export const AUTONOMY_DEFAULTS: AutonomyConfig = {
  enabled: false,
  minConfidence: 0.85,
  maxAmount: 200,
  requireKnownVendor: true,
};

// Categories that always go to a human, regardless of settings — matched on the
// account name. Conservative on purpose: money movement, equity, taxes, payroll.
const SENSITIVE_KEYWORDS = [
  'tax',
  'owner',
  'equity',
  'draw',
  'distribution',
  'transfer',
  'loan',
  'payroll',
  'ask my accountant',
  'retained',
  'opening balance',
];

const KEY = (realmId: string) => `autonomy:${realmId}`;

export async function getAutonomy(env: Env, realm: RealmRow): Promise<AutonomyConfig> {
  const raw = await env.COA_CACHE.get(KEY(realm.realm_id));
  if (!raw) return { ...AUTONOMY_DEFAULTS };
  try {
    return { ...AUTONOMY_DEFAULTS, ...(JSON.parse(raw) as Partial<AutonomyConfig>) };
  } catch {
    return { ...AUTONOMY_DEFAULTS };
  }
}

export async function setAutonomy(env: Env, realm: RealmRow, cfg: AutonomyConfig): Promise<void> {
  await env.COA_CACHE.put(KEY(realm.realm_id), JSON.stringify(cfg));
}

function isSensitive(accountName: string): boolean {
  const n = accountName.toLowerCase();
  return SENSITIVE_KEYWORDS.some((k) => n.includes(k));
}

// Returns null if the transaction clears every guardrail, otherwise a plain
// reason it was held back for a human.
function holdReason(
  t: TransactionRow,
  cfg: AutonomyConfig,
  known: Set<string>,
  acctName: Map<string, string>,
): string | null {
  if ((t.confidence ?? 0) < cfg.minConfidence) return 'not confident enough';
  if (Math.abs(t.amount) > cfg.maxAmount) return 'over the amount limit';
  const name = t.suggested_account ? acctName.get(t.suggested_account) ?? '' : '';
  if (isSensitive(name)) return 'sensitive category';
  if (cfg.requireKnownVendor) {
    const p = t.payee?.toLowerCase();
    if (!p || !known.has(p)) return 'new vendor';
  }
  return null;
}

export interface AutoApproveResult {
  approved: number;
  skipped: number;
  reasons: Record<string, number>;
}

// Auto-approve the pending, already-suggested transactions that clear every
// guardrail. Local review-state only — does not write anything to QBO.
export async function runAutoApprove(env: Env, realm: RealmRow): Promise<AutoApproveResult> {
  const cfg = await getAutonomy(env, realm);
  if (!cfg.enabled) return { approved: 0, skipped: 0, reasons: {} };

  const pending = (await listTransactions(env, realm.realm_id, 'pending')).filter(
    (t) => t.suggested_account && t.confidence !== null,
  );
  if (pending.length === 0) return { approved: 0, skipped: 0, reasons: {} };

  // "Known vendor" = a learned rule for the payee, or a payee we've reviewed before.
  const rules = await listRules(env, realm.realm_id);
  const known = new Set<string>();
  for (const r of rules) {
    if (r.match_field === 'payee' && r.match_op === 'equals') known.add(r.match_value.toLowerCase());
  }
  for (const p of await listApprovedPayees(env, realm.realm_id)) known.add(p.toLowerCase());

  const coaRaw = await env.COA_CACHE.get(`coa:${realm.realm_id}`);
  const coa: CoaEntry[] = coaRaw ? (JSON.parse(coaRaw) as CoaEntry[]) : [];
  const acctName = new Map(coa.map((a) => [a.id, a.name]));

  const reasons: Record<string, number> = {};
  let approved = 0;
  let skipped = 0;
  for (const t of pending) {
    const reason = holdReason(t, cfg, known, acctName);
    if (reason === null) {
      await approveTransactionAuto(env, t.id);
      approved++;
    } else {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      skipped++;
    }
  }

  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'autopilot_run',
    detail_json: JSON.stringify({ approved, skipped, reasons }),
  });
  return { approved, skipped, reasons };
}
