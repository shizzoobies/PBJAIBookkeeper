import type { Env, RealmRow } from './types';
import { listTransactionsInPeriod, audit } from './db';

const MATCH_DATE_WINDOW_DAYS = 3;
const STALE_DAYS = 30;
const AMOUNT_EPSILON = 0.01;

export interface StatementLine {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  raw: string;
}

interface BookRef {
  id: number;
  qbo_id: string;
  date: string;
  payee: string | null;
  description: string | null;
  amount: number;
}

export interface ReconcileWorksheet {
  period: { from: string; to: string };
  counts: { matched: number; bookOnly: number; statementOnly: number; duplicates: number; stale: number };
  matched: Array<{ book: BookRef; statement: StatementLine }>;
  bookOnly: BookRef[];
  statementOnly: StatementLine[];
  duplicates: Array<{ amount: number; date: string; payee: string | null; count: number; ids: number[] }>;
  stale: BookRef[];
}

// ---- CSV parsing (minimal, quote-aware) ----
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}

function parseAmount(s: string): number | null {
  let t = s.trim().replace(/[$,\s]/g, '');
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function parseStatementCsv(text: string): StatementLine[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length === 0) return [];
  const header = splitCsvLine(rows[0]!).map((h) => h.toLowerCase());
  const dateIdx = header.findIndex((h) => h.includes('date'));
  const amountIdx = header.findIndex((h) => h.includes('amount') || h === 'amt');
  const descIdx = header.findIndex(
    (h) => h.includes('desc') || h.includes('payee') || h.includes('memo') || h.includes('name'),
  );

  const lines: StatementLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = splitCsvLine(rows[i]!);
    const date = dateIdx >= 0 ? normalizeDate(cols[dateIdx] ?? '') : null;
    const amount = amountIdx >= 0 ? parseAmount(cols[amountIdx] ?? '') : null;
    if (!date || amount === null) continue;
    lines.push({
      date,
      description: descIdx >= 0 ? (cols[descIdx] ?? '') : '',
      amount,
      raw: rows[i]!,
    });
  }
  return lines;
}

// ---- Matching ----
function daysApart(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export async function reconcile(
  env: Env,
  realm: RealmRow,
  from: string,
  to: string,
  statement: StatementLine[],
): Promise<ReconcileWorksheet> {
  const txns = await listTransactionsInPeriod(env, realm.realm_id, from, to);
  const books: BookRef[] = txns.map((t) => ({
    id: t.id,
    qbo_id: t.qbo_id,
    date: t.txn_date,
    payee: t.payee,
    description: t.description,
    amount: t.amount,
  }));

  const matchedBook = new Set<number>();
  const matchedStmt = new Set<number>();
  const matched: Array<{ book: BookRef; statement: StatementLine }> = [];

  // Greedy best-match per statement line: same absolute amount, within the date
  // window, best date+payee score.
  for (let si = 0; si < statement.length; si++) {
    const line = statement[si]!;
    let best: { idx: number; score: number } | null = null;
    for (let bi = 0; bi < books.length; bi++) {
      const b = books[bi]!;
      if (matchedBook.has(b.id)) continue;
      if (Math.abs(Math.abs(b.amount) - Math.abs(line.amount)) > AMOUNT_EPSILON) continue;
      const dd = daysApart(b.date, line.date);
      if (dd > MATCH_DATE_WINDOW_DAYS) continue;
      const sim = tokenSimilarity(b.payee ?? b.description ?? '', line.description);
      const score = MATCH_DATE_WINDOW_DAYS - dd + sim * 2;
      if (!best || score > best.score) best = { idx: bi, score };
    }
    if (best) {
      const b = books[best.idx]!;
      matchedBook.add(b.id);
      matchedStmt.add(si);
      matched.push({ book: b, statement: line });
    }
  }

  const bookOnly = books.filter((b) => !matchedBook.has(b.id));
  const statementOnly = statement.filter((_, si) => !matchedStmt.has(si));

  // Duplicates: same amount + date + payee on the books more than once.
  const groups = new Map<string, BookRef[]>();
  for (const b of books) {
    const key = `${b.amount}|${b.date}|${(b.payee ?? '').toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(b);
    groups.set(key, arr);
  }
  const duplicates = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ amount: g[0]!.amount, date: g[0]!.date, payee: g[0]!.payee, count: g.length, ids: g.map((x) => x.id) }));

  // Stale: on the books, unmatched, and older than the threshold before period end.
  const stale = bookOnly.filter((b) => daysApart(b.date, to) > STALE_DAYS);

  const worksheet: ReconcileWorksheet = {
    period: { from, to },
    counts: {
      matched: matched.length,
      bookOnly: bookOnly.length,
      statementOnly: statementOnly.length,
      duplicates: duplicates.length,
      stale: stale.length,
    },
    matched,
    bookOnly,
    statementOnly,
    duplicates,
    stale,
  };

  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'system',
    action: 'reconcile_prepared',
    detail_json: JSON.stringify(worksheet.counts),
  });
  return worksheet;
}
