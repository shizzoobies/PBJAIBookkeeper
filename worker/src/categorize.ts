import type { Env, RealmRow } from './types';
import type { CoaEntry } from './sync';
import type { TransactionRow, RuleRow } from './db';
import {
  listRules,
  listTransactionsNeedingCategorization,
  setSuggestion,
  audit,
  listGuidance,
  type GuidanceRow,
} from './db';
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, CLASSIFIER_MODEL, CLASSIFY_BATCH_SIZE } from './constants';

// ---------------------------------------------------------------------------
// Layer 1 — deterministic rules (cheapest first).
// ---------------------------------------------------------------------------
function ruleMatches(rule: RuleRow, txn: TransactionRow): boolean {
  const field = rule.match_field === 'payee' ? txn.payee : txn.description;
  if (!field) return false;
  switch (rule.match_op) {
    case 'equals':
      return field.toLowerCase() === rule.match_value.toLowerCase();
    case 'contains':
      return field.toLowerCase().includes(rule.match_value.toLowerCase());
    case 'regex':
      try {
        return new RegExp(rule.match_value, 'i').test(field);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — Claude classifier for the remainder. Server-side only; the API key
// never reaches the browser. Returns qbo_id -> { account, confidence }.
// ---------------------------------------------------------------------------
interface Classification {
  qbo_id: string;
  account_qbo_id: string;
  confidence: number;
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

async function classifyWithClaude(
  env: Env,
  txns: TransactionRow[],
  coa: CoaEntry[],
  guidance: GuidanceRow[],
): Promise<Map<string, { account: string; confidence: number }>> {
  const out = new Map<string, { account: string; confidence: number }>();
  if (txns.length === 0 || coa.length === 0) return out;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const accountList = coa.map((a) => `${a.id}: ${a.name}${a.type ? ` (${a.type})` : ''}`).join('\n');

  // Plain-language "Teach" guidance from the firm, injected so the AI follows intent.
  const acctNameById = new Map(coa.map((a) => [a.id, a.name]));
  const guidanceBlock =
    guidance.length > 0
      ? 'Firm guidance — follow these when categorizing:\n' +
        guidance
          .map((g) => {
            const who = g.vendor ? `For "${g.vendor}": ` : '';
            const acct = g.account_qbo_id
              ? ` Prefer account ${g.account_qbo_id} (${acctNameById.get(g.account_qbo_id) ?? '?'}).`
              : '';
            return `- ${who}${g.note}.${acct}`;
          })
          .join('\n') +
        '\n\n'
      : '';

  const system =
    'You categorize business expense transactions into a QuickBooks chart of accounts. ' +
    'You are given accounts (as "id: name (type)") and transactions. For each transaction, pick the single best account id. ' +
    'Respond with ONLY a JSON array — no prose, no code fences — in exactly this shape:\n' +
    '[{"qbo_id":"<transaction id>","account_qbo_id":"<account id from the list>","confidence":<number 0..1>}]\n' +
    'Use only account ids from the provided list. confidence is your certainty (1 = certain, 0 = pure guess).';

  for (let i = 0; i < txns.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = txns.slice(i, i + CLASSIFY_BATCH_SIZE);
    const lines = batch
      .map((t) => `- id=${t.qbo_id} | payee=${t.payee ?? ''} | desc=${t.description ?? ''} | amount=${t.amount} | date=${t.txn_date}`)
      .join('\n');
    const userPrompt = `${guidanceBlock}Accounts:\n${accountList}\n\nTransactions:\n${lines}\n\nReturn the JSON array now.`;

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      // Leave this batch's transactions unsuggested; a human will review them.
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed as Classification[]) {
      if (item && typeof item.qbo_id === 'string' && typeof item.account_qbo_id === 'string') {
        const confidence =
          typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : 0.5;
        out.set(item.qbo_id, { account: item.account_qbo_id, confidence });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration: rules pass, then Claude for the remainder. Writes
// suggested_account + confidence; never auto-finalizes (human approves).
// ---------------------------------------------------------------------------
export async function categorizePending(
  env: Env,
  realm: RealmRow,
): Promise<{ rules: number; ai: number; total: number }> {
  const pending = await listTransactionsNeedingCategorization(env, realm.realm_id);
  if (pending.length === 0) return { rules: 0, ai: 0, total: 0 };

  const rules = await listRules(env, realm.realm_id);
  const coaRaw = await env.COA_CACHE.get(`coa:${realm.realm_id}`);
  const coa: CoaEntry[] = coaRaw ? (JSON.parse(coaRaw) as CoaEntry[]) : [];

  let ruleCount = 0;
  const needAi: TransactionRow[] = [];
  for (const txn of pending) {
    const matched = rules.find((r) => ruleMatches(r, txn));
    if (matched) {
      await setSuggestion(env, txn.id, matched.account_qbo_id, 1.0);
      ruleCount++;
    } else {
      needAi.push(txn);
    }
  }

  let aiCount = 0;
  if (needAi.length > 0) {
    const guidance = await listGuidance(env, realm.realm_id);
    const suggestions = await classifyWithClaude(env, needAi, coa, guidance);
    for (const txn of needAi) {
      const s = suggestions.get(txn.qbo_id);
      if (s) {
        await setSuggestion(env, txn.id, s.account, s.confidence);
        aiCount++;
      }
    }
  }

  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'transactions_categorized',
    detail_json: JSON.stringify({ rules: ruleCount, ai: aiCount, total: pending.length }),
  });
  return { rules: ruleCount, ai: aiCount, total: pending.length };
}
