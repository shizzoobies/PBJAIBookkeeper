import type { Env, RealmRow } from './types';
import { listActiveRealms, audit } from './db';
import { refreshRealmTokens } from './qbo';
import { refreshWindowSeconds } from './constants';

// Scheduled sweep: refresh tokens nearing expiry and persist the rotated refresh
// token. Runs hands-off from the Cron Trigger; it is also the exact code path the
// Phase 0 acceptance gate exercises.
export async function runTokenRefreshSweep(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const window = refreshWindowSeconds(env);

  let realms: RealmRow[];
  try {
    realms = await listActiveRealms(env);
  } catch (err) {
    await audit(env, {
      realm_id: null,
      actor: 'system',
      action: 'cron_sweep_failed',
      detail_json: JSON.stringify({ stage: 'list_realms', error: String(err) }),
    }).catch(() => {});
    throw err;
  }

  let refreshed = 0;
  for (const realm of realms) {
    const expiresIn = (realm.access_expires ?? 0) - now;
    // Skip tokens that are still comfortably valid.
    if (realm.access_expires !== null && expiresIn > window) continue;
    try {
      await refreshRealmTokens(env, realm);
      refreshed++;
    } catch {
      // refreshRealmTokens already audited the failure and (if permanent) set status.
    }
  }

  await audit(env, {
    realm_id: null,
    actor: 'system',
    action: 'cron_refresh_sweep',
    detail_json: JSON.stringify({ checked: realms.length, refreshed, window }),
  });
}
