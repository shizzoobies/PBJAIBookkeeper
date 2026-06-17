import type { Env, RealmRow } from './types';
import { query, createEntity, uploadAttachment } from './qbo';
import { audit } from './db';

// The reviewed, human-approved draft the dashboard sends to post into QBO. By the
// time it reaches here every line has a chosen account; a Purchase also carries
// the paid-from account.
export interface CapturePostRequest {
  docType: 'bill' | 'purchase';
  vendorName: string;
  txnDate: string; // YYYY-MM-DD
  lines: Array<{ description: string; amount: number; accountId: string }>;
  paymentType?: 'Cash' | 'Check' | 'CreditCard'; // Purchase only
  paymentAccountId?: string; // Purchase only — the bank/credit-card account it was paid from
}

export interface CaptureFile {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}

function escapeQbo(value: string): string {
  return value.replace(/'/g, "\\'");
}

interface VendorQueryResponse {
  QueryResponse?: { Vendor?: Array<{ Id: string; DisplayName: string }> };
}

// Find a vendor by display name, creating one if it doesn't exist yet.
export async function ensureVendor(env: Env, realm: RealmRow, displayName: string): Promise<{ id: string; name: string }> {
  const name = displayName.trim();
  const found = await query<VendorQueryResponse>(
    env,
    realm,
    `SELECT Id, DisplayName FROM Vendor WHERE DisplayName = '${escapeQbo(name)}'`,
  );
  const existing = found.QueryResponse?.Vendor?.[0];
  if (existing) return { id: existing.Id, name: existing.DisplayName };

  const created = await createEntity<{ Vendor: { Id: string; DisplayName: string } }>(env, realm, 'vendor', {
    DisplayName: name,
  });
  return { id: created.Vendor.Id, name: created.Vendor.DisplayName };
}

// Post a reviewed capture to QBO as a Bill or Purchase, then attach the source
// document (best-effort — a failed attach never undoes the created transaction).
export async function postCapture(
  env: Env,
  realm: RealmRow,
  req: CapturePostRequest,
  file?: CaptureFile,
): Promise<{ entityType: 'Bill' | 'Purchase'; entityId: string; vendor: string; attached: boolean }> {
  const vendor = await ensureVendor(env, realm, req.vendorName);

  const line = req.lines.map((l) => ({
    DetailType: 'AccountBasedExpenseLineDetail',
    Amount: l.amount,
    Description: l.description || undefined,
    AccountBasedExpenseLineDetail: { AccountRef: { value: l.accountId } },
  }));

  let entityType: 'Bill' | 'Purchase';
  let entityId: string;

  if (req.docType === 'bill') {
    const created = await createEntity<{ Bill: { Id: string } }>(env, realm, 'bill', {
      VendorRef: { value: vendor.id },
      TxnDate: req.txnDate,
      Line: line,
    });
    entityType = 'Bill';
    entityId = created.Bill.Id;
  } else {
    const created = await createEntity<{ Purchase: { Id: string } }>(env, realm, 'purchase', {
      PaymentType: req.paymentType ?? 'CreditCard',
      AccountRef: { value: req.paymentAccountId },
      EntityRef: { value: vendor.id, type: 'Vendor' },
      TxnDate: req.txnDate,
      Line: line,
    });
    entityType = 'Purchase';
    entityId = created.Purchase.Id;
  }

  let attached = false;
  if (file) {
    try {
      await uploadAttachment(env, realm, {
        entityType,
        entityId,
        fileName: file.fileName,
        contentType: file.contentType,
        bytes: file.bytes,
      });
      attached = true;
    } catch {
      // Best-effort: the transaction is already created; the receipt just isn't attached.
    }
  }

  await audit(env, {
    realm_id: realm.realm_id,
    actor: 'user',
    action: 'capture_posted',
    detail_json: JSON.stringify({ entityType, entityId, vendor: vendor.name, attached }),
  });

  return { entityType, entityId, vendor: vendor.name, attached };
}
