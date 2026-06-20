# AGENTS.md — gsdb Development Guidance

This document is the source of truth for architectural decisions and constraints on this project. Future AI agents should read this carefully before making changes.

**TL;DR:** gsdb is a zero-infra Google Sheets REST proxy. It prioritizes simplicity over flexibility. Do not:
- Add external databases, message queues, or caching layers
- Use wrangler or any CLI deploy tools
- Change OAuth scopes away from `drive.file`
- Import the AWS SDK (use Bun's native S3 instead)
- Treat user-provided spreadsheets as trusted (only touch sheets gsdb creates)

---

## Core Philosophy

**One source of truth per layer:**
- **App registry** → Master Sheet (a Google Sheet named "gsdb Registry" with tab "Apps")
- **Auth cache** → in-process Map with 5-min TTL (no Redis, no KV)
- **Refresh token** → `GOOGLE_REFRESH_TOKEN` env var (no D1, no database)
- **File storage** → S3-compatible (AWS, R2, B2, MinIO via `S3_ENDPOINT`)

The entire stack is meant to be **run and deployed without CLI tools or extra infrastructure.** Users clone the repo, set 5 env vars, and deploy via Vercel's git integration.

---

## Architecture Rules

### OAuth & Permissions

**Scope: Always `drive.file`, never broader.**
- `drive.file` = gsdb can only read/write files it created or that users explicitly opened through gsdb
- This is a hard security boundary — don't change it
- If a user asks for broader access (e.g., `spreadsheets` scope to read existing sheets), the answer is "gsdb creates dedicated sheets per app; you cannot use existing sheets"

**On first OAuth (`/auth/callback`):**
- User redirects from Google with `code`
- Exchange code for both `refresh_token` and `access_token`
- If no `MASTER_SHEET_ID` is set in env, create a new Google Sheet called "gsdb Registry" with tab "Apps" using the fresh `access_token`
- Display both `GOOGLE_REFRESH_TOKEN` and `MASTER_SHEET_ID` so user can paste into Vercel
- The Master Sheet persists — future auths reuse it if it already exists

**App registration (`POST /manage/apps`):**
- Only input: `{ "app_id": "..." }`
- gsdb creates a new Google Sheet for that app (using the refresh token's access)
- Returns `{ app_id, api_key, spreadsheet_id }`
- The sheet is owned by the service account and only accessible to gsdb

### Storage & State

**No D1 (SQL), no Upstash, no Vercel KV, no Redis.**
- The Master Sheet IS the database: it stores `app_id | spreadsheet_id | api_key_hash | created_at`
- `rewriteMasterSheetApps()` (clear then PUT) handles deletes and key rotation — it's atomic enough for our scale
- In-process Map caches the entire app list for 5 minutes — at most one Sheets API call per Vercel instance per 5 min
- Cold Vercel instances miss the cache and re-fetch from the Master Sheet (cost: ~100ms, acceptable)

**S3 file storage is optional:**
- Uses Bun's native `S3Client` from `"bun"` — zero external packages, provider-agnostic
- Supports AWS S3, Cloudflare R2, Backblaze B2, MinIO (all via `S3_ENDPOINT` override)
- If `S3_BUCKET` is not set, `/files/*` routes return 501
- Pre-signed URLs are sync (`s3.presign()`) — no async await overhead
- **S3 key structure:** `{app_id}/{user-supplied-key}` — e.g. `myapp/receipts/jan.png`. Filter by prefix in S3 console or `aws s3 ls s3://bucket/myapp/` to see a specific app's files. Cross-app access is blocked by key validation in `src/routes/files.ts`.

### Deployment & Runtime

**Vercel only (primary), Cloudflare Workers secondary (unmaintained):**
- Entry point: `api/index.ts` re-exports `platform/vercel.ts`
- `vercel.json` rewrites all routes to `/api/index` (Vercel's constraint: only `api/` is auto-executed)
- Runtime: Bun (`runtime: "bun@1"` in `vercel.json`)
- No wrangler, no `vercel` CLI — just `git push` to deploy

**Local dev:**
- `platform/node.ts` uses `Bun.serve()` — no external server adapter
- Run with `bun run dev` (or `bun platform/node.ts`)
- Reads `.env.local` for secrets

**Platform-injected env:**
- Each platform adapter has a `getBindings()` function that reads from `process.env` and passes to `app.fetch(req, bindings)`
- This ensures `c.env` is always populated, regardless of platform

### Code Style & Structure

**Comments:** Concise and only when the "why" is non-obvious. No docstrings or block comments for obvious code.

**Types:** Full TypeScript with strict mode. `skipLibCheck: true` to avoid `@cloudflare/workers-types` vs `@types/bun` conflicts.

**File organization:**
```
src/
  auth/        OAuth flow, token refresh
  kv/          In-process Map cache (not KV, just a Map)
  middleware/  Hono middleware (auth, admin checks)
  routes/      API endpoints (data, files, manage)
  ui/          Server-rendered JSX dashboard
  utils/       GoogleClient, crypto helpers
platform/
  vercel.ts    Vercel entry
  node.ts      Local dev
  cloudflare.ts (maintained but not actively deployed)
```

**Imports:**
- `.tsx` files use `import` with explicit extension (e.g., `import UI from './pages/Dashboard.tsx'`)
- `jsxImportSource: "hono/jsx"` in tsconfig — no React, no bundle bloat
- `@hono/zod-openapi` for all routes — Zod schema is the source of truth for validation + OpenAPI

---

## Common Tasks

### Adding a new route

1. Create a `.ts` or `.tsx` file in `src/routes/`
2. Use `OpenAPIHono<Env>` and `createRoute()` + `z` schema
3. If it needs auth, add `middleware: [appAuthMiddleware]`
4. Register in `src/index.ts` with `app.route()`

Example:
```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import type { Env } from '../types';

export const exampleRouter = new OpenAPIHono<Env>();

exampleRouter.openapi(
  createRoute({
    method: 'get',
    path: '/example',
    middleware: [appAuthMiddleware] as const,
    responses: {
      200: {
        description: 'Example',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  (c) => c.json({ message: 'Hello' })
);
```

### Caching & Invalidation

- `cache.get(key)` and `cache.set(key, value, ttlSeconds)` from `src/kv/index.ts`
- `invalidateAppsCache()` from `src/middleware/auth.ts` to clear the apps list on writes
- No other caching — keep it simple

### Adding env vars

1. Add to `src/types.ts` in `Env['Bindings']`
2. Wire in `platform/vercel.ts` and `platform/node.ts`
3. Document in `.env.example`
4. Update `README.md`

### Testing OAuth locally

1. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`
2. Add `http://localhost:3000/auth/callback` to your GCP OAuth app's redirect URIs
3. Run `bun run dev` and visit `http://localhost:3000/auth/login`
4. Callback shows the token — paste it into `.env.local` and restart

---

## What NOT to Do

### Don't add wrangler
- Vercel is the primary target and deploys via git
- Cloudflare Workers support is secondary (unmaintained)
- Wrangler adds cognitive overhead and doesn't help here

### Don't add external KV (Upstash, Vercel KV, Redis)
- The Master Sheet is already persistent
- Vercel KV is being sunset anyway
- In-process Map is good enough for auth caching
- If you need persistent cross-instance state, it belongs in the Master Sheet

### Don't use `@aws-sdk/client-s3`
- It's 40+ MB of packages we don't need
- Bun's native `S3Client` does everything and is zero-dependency
- Import: `import { S3Client } from "bun"`

### Don't broaden OAuth scopes
- Users ask for `spreadsheets` or `drive.readonly` to access existing sheets
- Answer: "Each app gets its own dedicated sheet created by gsdb; you cannot use existing sheets"
- Staying on `drive.file` keeps the token's blast radius minimal and makes the security model clear

### Don't store refresh tokens in D1, Vercel KV, or any database
- The refresh token goes in `GOOGLE_REFRESH_TOKEN` env var, set once in Vercel
- It's long-lived and rarely rotates
- There's no need to query it — it's just read once per request

### Don't assume Master Sheet format
- The Master Sheet has tab "Apps" with columns: `app_id | spreadsheet_id | api_key_hash | created_at`
- Don't rename columns, don't add columns (update docs first if you do)
- `rewriteMasterSheetApps()` is the canonical way to mutate the registry

---

## Debugging & Common Issues

**"GOOGLE_REFRESH_TOKEN is not set"**
- User hasn't run `/auth/login` yet, or hasn't set it in Vercel env vars
- Direct them to set up locally first (run `/auth/login`, copy the token from the callback page into `.env.local`)

**"Auth middleware cached stale apps"**
- Apps cache has 5-min TTL. If a user edits the Master Sheet directly (not via `/manage`), they won't see changes until cache expires
- `invalidateAppsCache()` clears it immediately — called after every write via `/manage`
- If needed, restart the Vercel instance (redeploy)

**"drive.file scope is too restrictive"**
- gsdb is designed around this model: one sheet per app, no access to existing sheets
- If a user has existing sheets in their Google Drive they want to use, the answer is no — gsdb creates dedicated sheets
- This is a feature, not a limitation

---

## Future Considerations

- **Sharding the Master Sheet** (if >1000 apps): split into multiple tabs or sheets by app prefix
- **Audit logging**: write access logs to a separate Google Sheet or S3
- **API key rotation**: currently sync'd to Master Sheet; consider versioning if rotation needs to be instant across instances
- **GViz SQL dialect limits**: Google Sheets query language is less powerful than full SQL; document what queries work
- **File storage object lifecycle**: consider auto-deleting files after N days or adding versioning

These are nice-to-haves, not blockers. Keep the codebase minimal until one of these actually becomes painful.

---

## Reference: Key Files

| File | Purpose |
|---|---|
| `src/types.ts` | Env bindings and AppRecord shape |
| `src/auth/index.ts` | OAuth flow (login, callback, token refresh) |
| `src/utils/google.ts` | All Google Sheets API calls (GViz, append, Master Sheet ops) |
| `src/middleware/auth.ts` | Auth caching and validation |
| `src/routes/manage.ts` | App CRUD (register, delete, rotate key) |
| `src/routes/data.ts` | User query endpoint (GET/POST sheets) |
| `src/routes/files.ts` | S3 file operations |
| `src/ui/pages/Dashboard.tsx` | Admin dashboard |
| `platform/vercel.ts` | Vercel entry point |
| `platform/node.ts` | Local dev server |
| `vercel.json` | Vercel routing and runtime config |
