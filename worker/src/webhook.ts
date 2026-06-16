import type { Context } from 'hono';
import type { Env } from './types';
import { bytesToBase64 } from './crypto';
import { audit } from './db';

// Constant-time comparison so signature checks don't leak timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Intuit signs each webhook: base64(HMAC-SHA256(rawBody, verifierToken)) in the
// `intuit-signature` header.
async function isValidSignature(env: Env, rawBody: string, signature: string | undefined): Promise<boolean> {
  if (!env.QBO_WEBHOOK_VERIFIER || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.QBO_WEBHOOK_VERIFIER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  return timingSafeEqual(bytesToBase64(mac), signature);
}

export const handleWebhook = async (c: Context<{ Bindings: Env }>) => {
  // Until the verifier token is configured we cannot authenticate callers.
  if (!c.env.QBO_WEBHOOK_VERIFIER) {
    return c.json({ error: 'webhook_not_configured' }, 503);
  }
  const rawBody = await c.req.text();
  const signature = c.req.header('intuit-signature');
  if (!(await isValidSignature(c.env, rawBody, signature))) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  // Phase 1: parse the CDC payload (Zod) and enqueue sync jobs. For now, record receipt.
  await audit(c.env, {
    realm_id: null,
    actor: 'system',
    action: 'webhook_received',
    detail_json: rawBody.slice(0, 2000),
  });
  return c.json({ ok: true });
};
