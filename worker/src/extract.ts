import type { Env } from './types';
import type { CoaEntry } from './sync';
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, EXTRACT_MODEL } from './constants';

// One line of a captured document, with the AI's suggested expense account.
export interface CaptureLine {
  description: string;
  amount: number;
  accountId: string | null; // suggested QBO Account id, or null if unsure
}

// Structured data the model pulls out of a receipt or vendor bill. This is a
// *draft* — a human reviews and edits it before anything is written to QBO.
export interface CaptureDraft {
  suggestedDocType: 'bill' | 'purchase';
  vendorName: string | null;
  txnDate: string | null; // YYYY-MM-DD
  total: number | null;
  currency: string | null;
  lines: CaptureLine[];
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function stripCodeFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

// Send the receipt/bill (image or PDF) to Claude (vision) and get back structured
// fields plus a suggested expense account per line. Server-side only; the API key
// never reaches the browser. Images use an `image` block; PDFs a `document` block.
export async function extractDocument(
  env: Env,
  file: { mediaType: string; dataBase64: string },
  coa: CoaEntry[],
): Promise<CaptureDraft> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const accountList = coa.map((a) => `${a.id}: ${a.name}${a.type ? ` (${a.type})` : ''}`).join('\n');

  const docBlock = IMAGE_TYPES.has(file.mediaType)
    ? { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.dataBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.dataBase64 } };

  const system =
    'You extract structured data from a vendor receipt or bill for bookkeeping. ' +
    'Respond with ONLY JSON — no prose, no code fences — in exactly this shape:\n' +
    '{"suggestedDocType":"bill"|"purchase","vendorName":string|null,"txnDate":"YYYY-MM-DD"|null,' +
    '"total":number|null,"currency":string|null,' +
    '"lines":[{"description":string,"amount":number,"accountId":string|null}]}\n' +
    'suggestedDocType: "purchase" if the document looks already paid (a receipt), "bill" if it is an invoice to be paid later. ' +
    'For each line, choose the best expense account id from the provided chart of accounts, or null if unsure. ' +
    'Use only account ids from the list. Each amount is a positive number. If only a single total is present, return one line.';

  const userText = `Chart of accounts:\n${accountList}\n\nExtract the document now as JSON.`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: userText }] }],
    }),
  });
  if (!res.ok) {
    // M1: never echo the raw provider body.
    throw new Error(`Anthropic extract failed (status ${res.status})`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(stripCodeFences(text)) as Partial<CaptureDraft>;

  return {
    suggestedDocType: parsed.suggestedDocType === 'bill' ? 'bill' : 'purchase',
    vendorName: parsed.vendorName ?? null,
    txnDate: parsed.txnDate ?? null,
    total: typeof parsed.total === 'number' ? parsed.total : null,
    currency: parsed.currency ?? null,
    lines: Array.isArray(parsed.lines)
      ? parsed.lines.map((l) => ({
          description: String(l?.description ?? ''),
          amount: Number(l?.amount) || 0,
          accountId: l?.accountId ?? null,
        }))
      : [],
  };
}

// One extracted bank-statement line.
export interface StatementTxn {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative = money out (debit), positive = money in (credit)
}

// Extract every transaction from a bank/credit-card statement (image or PDF) — for
// clients whose bank won't link to QBO, so the statement is the transaction source.
export async function extractStatementLines(
  env: Env,
  file: { mediaType: string; dataBase64: string },
): Promise<StatementTxn[]> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const docBlock = IMAGE_TYPES.has(file.mediaType)
    ? { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.dataBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.dataBase64 } };

  const system =
    'You extract every transaction line from a bank or credit-card statement. ' +
    'Respond with ONLY a JSON array — no prose, no code fences — of objects ' +
    '{"date":"YYYY-MM-DD","description":string,"amount":number}. ' +
    'amount is NEGATIVE for money out (withdrawals, debits, card purchases, payments, fees) and ' +
    'POSITIVE for money in (deposits, credits, refunds). ' +
    'Include every transaction; skip running balances, page headers, and summary/total rows.';

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      max_tokens: 8192,
      system,
      messages: [
        { role: 'user', content: [docBlock, { type: 'text', text: 'Extract every transaction now as a JSON array.' }] },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic statement extract failed (status ${res.status})`);
  }

  const data = (await res.json()) as AnthropicResponse;
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(stripCodeFences(text)) as Array<Partial<StatementTxn>>;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((l) => l && typeof l.amount === 'number' && typeof l.date === 'string')
    .map((l) => ({ date: String(l.date), description: String(l.description ?? ''), amount: Number(l.amount) || 0 }));
}
