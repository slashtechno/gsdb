// In-process cache backed by a module-level Map.
// Survives for the lifetime of a Vercel function instance (reused via Fluid Compute).
// Not shared across parallel instances — acceptable for an auth proxy.

interface CacheEntry { val: unknown; exp: number | null; }
const store = new Map<string, CacheEntry>();

export const cache = {
  get<T>(key: string): T | null {
    const item = store.get(key);
    if (!item) return null;
    if (item.exp !== null && Date.now() > item.exp) { store.delete(key); return null; }
    return item.val as T;
  },

  set(key: string, value: unknown, ttlSeconds?: number): void {
    store.set(key, { val: value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  },

  delete(key: string): void { store.delete(key); },

  // Removes all keys that match a prefix — used when invalidating the app registry cache.
  deleteByPrefix(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  },
};
