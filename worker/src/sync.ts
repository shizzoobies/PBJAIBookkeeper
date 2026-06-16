import type { Env, RealmRow } from './types';
import { queryAll } from './qbo';
import { upsertTransaction, audit } from './db';

interface QboAccount {
  Id: string;
  Name: string;
  AccountType?: string;
  AccountSubType?: string;
  Classification?: string;
  Active?: boolean;
}

// Compact chart-of-accounts entry cached in KV (coa:<realm_id>) so categorization
// never burns a read per transaction.
export interface CoaEntry {
  id: string;
  name: string;
  type: string;
  subtype: string;
  classification: string;
}

export async function syncChartOfAccounts(env: Env, realm: RealmRow): Promise<number> {
  const accounts = await queryAll<QboAccount>(env, realm, 'Account');
  const coa: CoaEntry[] = accounts.map((a) => ({
    id: a.Id,
    name: a.Name,
    type: a.AccountType ?? '',
    subtype: a.AccountSubType ?? '',
    classification: a.Classification ?? '',
  }));
  await env.COA_CACHE.put(`coa:${realm.realm_id}`, JSON.stringify(coa));
  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'coa_synced',
    detail_json: JSON.stringify({ count: coa.length }),
  });
  return coa.length;
}

interface QboPurchaseLine {
  DetailType?: string;
  AccountBasedExpenseLineDetail?: { AccountRef?: { value: string; name?: string } };
}
interface QboPurchase {
  Id: string;
  TxnDate: string;
  TotalAmt?: number;
  PrivateNote?: string;
  EntityRef?: { value: string; name?: string };
  Line?: QboPurchaseLine[];
}

// Phase 1 focuses on Purchases (expenses) — the transactions a bookkeeper
// categorizes. Money out is stored as a negative amount per the schema.
export async function syncTransactions(env: Env, realm: RealmRow): Promise<number> {
  const purchases = await queryAll<QboPurchase>(env, realm, 'Purchase');
  for (const p of purchases) {
    const expenseLine = p.Line?.find((l) => l.DetailType === 'AccountBasedExpenseLineDetail');
    const accountQboId = expenseLine?.AccountBasedExpenseLineDetail?.AccountRef?.value ?? null;
    await upsertTransaction(env, {
      realmId: realm.realm_id,
      qboId: p.Id,
      txnType: 'Purchase',
      txnDate: p.TxnDate,
      description: p.PrivateNote ?? null,
      payee: p.EntityRef?.name ?? null,
      amount: -(p.TotalAmt ?? 0),
      accountQboId,
      rawJson: JSON.stringify(p),
    });
  }
  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'transactions_synced',
    detail_json: JSON.stringify({ count: purchases.length }),
  });
  return purchases.length;
}

export async function runSync(env: Env, realm: RealmRow): Promise<{ accounts: number; transactions: number }> {
  const accounts = await syncChartOfAccounts(env, realm);
  const transactions = await syncTransactions(env, realm);
  return { accounts, transactions };
}
