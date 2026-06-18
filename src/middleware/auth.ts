import { createMiddleware } from 'hono/factory';
import { cache } from '../kv';
import { hashApiKey } from '../utils/crypto';
import { GoogleClient } from '../utils/google';
import type { Env, AppRecord } from '../types';

// Apps are cached for 5 minutes. All app records are loaded at once
// so we only need one Sheets API call per cache lifetime — not one per request.
const CACHE_TTL = 300; // seconds
const APPS_CACHE_KEY = 'apps:all';

// Fetches app list from cache or Master Sheet.
async function getApps(env: Env['Bindings']): Promise<AppRecord[]> {
  const cached = cache.get<AppRecord[]>(APPS_CACHE_KEY);
  if (cached) return cached;

  const apps = await GoogleClient.getMasterSheetApps(env);
  cache.set(APPS_CACHE_KEY, apps, CACHE_TTL);
  return apps;
}

// Call after any write to the Master Sheet so the next request gets fresh data.
export function invalidateAppsCache(): void {
  cache.delete(APPS_CACHE_KEY);
}

// Call after key rotation so the old per-token cache entry can't bypass the hash check.
export function invalidateAppTokens(appId: string): void {
  cache.deleteByPrefix(`auth:${appId}:`);
}

// Validates the Bearer token against the Master Sheet app registry.
// Also accepts a valid X-Admin-Secret header as an alternative credential — the admin
// already has full write access (rotate/delete), so read access is a lesser privilege.
export const appAuthMiddleware = createMiddleware<Env>(async (c, next) => {
  const appId = c.req.param('app_id');
  if (!appId) return c.json({ error: 'Missing app_id' }, 400);

  // Admin bypass: if the request carries a valid admin secret, skip the per-app key check.
  const adminSecret = c.req.header('X-Admin-Secret');
  if (adminSecret) {
    if (!c.env.ADMIN_SECRET || adminSecret !== c.env.ADMIN_SECRET) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const apps = await getApps(c.env);
    const app = apps.find((a) => a.app_id === appId);
    if (!app) return c.json({ error: 'App not found' }, 404);
    c.set('spreadsheet_id', app.spreadsheet_id);
    c.set('app_id', appId);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: missing Bearer token' }, 401);
  }

  const apiKey = authHeader.slice(7);

  // Per-token fast path: avoids re-hashing on repeated requests from the same client
  const tokenCacheKey = `auth:${appId}:${apiKey}`;
  let spreadsheetId = cache.get<string>(tokenCacheKey);

  if (!spreadsheetId) {
    const apps = await getApps(c.env);
    const app = apps.find((a) => a.app_id === appId);
    if (!app) return c.json({ error: 'Invalid API key or app_id' }, 403);

    const keyHash = await hashApiKey(apiKey);
    if (app.api_key_hash !== keyHash) return c.json({ error: 'Invalid API key or app_id' }, 403);

    spreadsheetId = app.spreadsheet_id;
    cache.set(tokenCacheKey, spreadsheetId, CACHE_TTL);
  }

  c.set('spreadsheet_id', spreadsheetId);
  c.set('app_id', appId);
  await next();
});

// Protects /manage/* routes with a static secret passed as X-Admin-Secret header.
export const adminAuthMiddleware = createMiddleware<Env>(async (c, next) => {
  if (!c.env.ADMIN_SECRET) {
    return c.json({ error: 'Server misconfigured: ADMIN_SECRET env var is not set' }, 500);
  }
  const secret = c.req.header('X-Admin-Secret');
  if (!secret || secret !== c.env.ADMIN_SECRET) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});
