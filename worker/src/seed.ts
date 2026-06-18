import type { Env, RealmRow } from './types';
import { queryAll, createEntity } from './qbo';
import { audit } from './db';

interface QboAccount {
  Id: string;
  Name: string;
  AccountType?: string;
  Classification?: string;
}
interface QboVendor {
  Id: string;
  DisplayName: string;
}

interface DemoTxn {
  payee: string;
  amount: number;
  daysAgo: number;
  note: string;
}

// A varied set of posted expenses so Review (categorization), Reconcile, and
// Reports all have realistic data to show in a demo.
const DEMO: DemoTxn[] = [
  { payee: 'Office Depot', amount: 84.22, daysAgo: 4, note: 'Printer paper and toner' },
  { payee: 'Shell', amount: 52.1, daysAgo: 6, note: 'Fuel' },
  { payee: 'Amazon Web Services', amount: 214.0, daysAgo: 9, note: 'Cloud hosting' },
  { payee: 'Starbucks', amount: 18.75, daysAgo: 11, note: 'Client coffee' },
  { payee: 'FedEx', amount: 39.99, daysAgo: 13, note: 'Shipping' },
  { payee: 'Verizon Wireless', amount: 110.45, daysAgo: 15, note: 'Mobile phone' },
  { payee: 'Home Depot', amount: 146.3, daysAgo: 18, note: 'Job-site supplies' },
  { payee: 'Delta Air Lines', amount: 412.6, daysAgo: 22, note: 'Flight to client' },
  { payee: 'Adobe', amount: 54.99, daysAgo: 25, note: 'Creative Cloud subscription' }, // duplicated below
  { payee: 'Costco', amount: 233.18, daysAgo: 28, note: 'Office kitchen supplies' },
  { payee: 'Uber', amount: 27.4, daysAgo: 31, note: 'Ride to client meeting' },
  { payee: 'WeWork', amount: 650.0, daysAgo: 34, note: 'Coworking space' },
  { payee: 'Staples', amount: 61.05, daysAgo: 40, note: 'Office supplies' },
  { payee: 'Comcast Business', amount: 99.0, daysAgo: 45, note: 'Internet service' },
  { payee: 'LinkedIn', amount: 39.99, daysAgo: 52, note: 'Recruiting subscription' },
  { payee: 'United Airlines', amount: 388.2, daysAgo: 68, note: 'Conference travel' }, // old → goes stale
];

const DUPLICATE_INDEX = 8; // Adobe, created twice → shows the duplicate flag in Reconcile
// Left off the bank statement on purpose: 0,1 → "on the books, not on the statement";
// 15 (68 days old) → also "stale outstanding".
const OMIT_FROM_STATEMENT = new Set([0, 1, 15]);

function isoDaysAgo(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
}

// Create a batch of demo expenses (with real vendors so the review queue shows
// payees) and return a matching bank-statement CSV crafted to exercise every
// reconciliation bucket: matched, book-only, statement-only, duplicate, stale.
export async function seedDemoData(
  env: Env,
  realm: RealmRow,
): Promise<{ created: number; duplicates: number; bankCsv: string; period: { from: string; to: string } }> {
  const nowMs = Date.now();

  const accounts = await queryAll<QboAccount>(env, realm, 'Account');
  const bank = accounts.find((a) => a.AccountType === 'Bank') ?? accounts.find((a) => a.AccountType === 'Credit Card');
  const expense = accounts.filter((a) => a.Classification === 'Expense');
  if (!bank) throw new Error('seed: no bank or credit-card account found in this company');
  if (expense.length === 0) throw new Error('seed: no expense accounts found in this company');

  // Resolve vendors once (1 read), creating any that don't exist — idempotent on re-run.
  const vendors = await queryAll<QboVendor>(env, realm, 'Vendor');
  const byName = new Map(vendors.map((v) => [v.DisplayName.toLowerCase(), v.Id]));
  const vendorId = async (name: string): Promise<string> => {
    const hit = byName.get(name.toLowerCase());
    if (hit) return hit;
    const c = await createEntity<{ Vendor: { Id: string } }>(env, realm, 'vendor', { DisplayName: name });
    byName.set(name.toLowerCase(), c.Vendor.Id);
    return c.Vendor.Id;
  };

  const toCreate = [...DEMO, DEMO[DUPLICATE_INDEX]!]; // append the duplicate
  let created = 0;
  let acctCursor = 0;
  for (const t of toCreate) {
    const vid = await vendorId(t.payee);
    const acct = expense[acctCursor % expense.length]!;
    acctCursor++;
    await createEntity(env, realm, 'purchase', {
      PaymentType: 'CreditCard',
      AccountRef: { value: bank.Id },
      EntityRef: { value: vid, type: 'Vendor' },
      TxnDate: isoDaysAgo(nowMs, t.daysAgo),
      PrivateNote: t.note,
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: t.amount,
          AccountBasedExpenseLineDetail: { AccountRef: { value: acct.Id } },
        },
      ],
    });
    created++;
  }

  // Bank statement CSV: match most, omit a few (book-only / stale), and add two
  // lines that aren't on the books (statement-only).
  const rows: string[] = ['Date,Description,Amount'];
  DEMO.forEach((t, i) => {
    if (OMIT_FROM_STATEMENT.has(i)) return;
    rows.push(`${isoDaysAgo(nowMs, t.daysAgo)},${t.payee},-${t.amount.toFixed(2)}`);
  });
  rows.push(`${isoDaysAgo(nowMs, 3)},Bank Service Fee,-12.00`);
  rows.push(`${isoDaysAgo(nowMs, 20)},Interest Earned,3.21`);
  const bankCsv = rows.join('\n') + '\n';

  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'user',
    action: 'demo_seeded',
    detail_json: JSON.stringify({ created }),
  });

  return {
    created,
    duplicates: 1,
    bankCsv,
    period: { from: isoDaysAgo(nowMs, 90), to: isoDaysAgo(nowMs, 0) },
  };
}
