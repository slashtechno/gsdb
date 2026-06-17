note: I heavily used AI to make this as a proof of concept and to create small DBs for small projects. This is not meant to be used in anything critical.

# gsdb

A serverless REST proxy that turns any Google Sheet into an API endpoint.

---

## Architecture

```
client
  └── Bearer {api_key}
        └── /api/{app_id}/{table}
              └── Auth middleware
                    ├── in-process cache (5-min TTL, per Vercel instance)
                    └── Master Sheet lookup on cache miss
                          └── GoogleClient.query()
                                └── Google Sheets GViz API
```

**Storage model — no external database:**
- **Master Sheet** (`MASTER_SHEET_ID`) — one Google Sheet that acts as the app registry. Tab `Apps` holds: `app_id | spreadsheet_id | api_key_hash | created_at`.
- **`GOOGLE_REFRESH_TOKEN`** — a long-lived credential stored as a Vercel env var. Exchanged for a short-lived access token at query time.
- **In-process Map** — caches auth lookups for 5 minutes within a Vercel function instance. Cold instances re-query the Master Sheet.

**Key directories:**
```
src/
  auth/        OAuth login + callback
  kv/          In-process cache (Map)
  middleware/  appAuthMiddleware + adminAuthMiddleware
  routes/      data.ts (GViz queries), files.ts (R2), manage.ts (CRUD)
  ui/          Server-rendered JSX dashboard
  utils/       GoogleClient (all Sheets API calls) + crypto helpers
platform/
  vercel.ts    Injects process.env → c.env, exports default handler
  node.ts      Local Bun dev server
  cloudflare.ts  CF Workers entry (optional)
api/
  index.ts     Re-exports platform/vercel — Vercel routes all traffic here
```

---

## Setup

### 1. Google Cloud credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **New Project**.
2. Enable two APIs: **Google Sheets API** and **Google Drive API**.
3. Go to **Credentials** → **Create Credentials** → **OAuth Client ID**.
   - If prompted, configure the consent screen (External, no scopes needed, just add your email).
   - Application type: **Web application**
   - Authorized redirect URIs: `https://your-vercel-domain.vercel.app/auth/callback`
   - For local dev also add: `http://localhost:3000/auth/callback`
4. Copy the **Client ID** and **Client Secret**.
5. Go to Audience and add your email as a test user.

> **What gsdb can access:** The OAuth scope is `drive.file` — gsdb can only read and write files it creates. It has zero access to existing sheets on the authorized Google account. Each app registered via `/manage/apps` gets its own dedicated spreadsheet created by gsdb.

### 2. Local development

```bash
cp .env.example .env.local
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_SECRET

bun install
bun run dev          # http://localhost:3000
```

Visit `http://localhost:3000/auth/login` to complete OAuth. The callback page shows both `GOOGLE_REFRESH_TOKEN` and `MASTER_SHEET_ID` (gsdb creates the Master Sheet automatically) — copy both into `.env.local`, then restart the server.

### 4. Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in [vercel.com/new](https://vercel.com/new).
3. Set these environment variables in Project → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | From `/auth/callback` page |
| `MASTER_SHEET_ID` | From `/auth/callback` page (auto-created) |
| `ADMIN_SECRET` | Any random secret you choose |

4. Deploy. Visit `https://your-domain/ui` to confirm everything is connected.

---

## Usage

### Register an app

```bash
curl -X POST https://your-domain/manage/apps \
  -H "X-Admin-Secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{ "app_id": "my-app" }'
```

gsdb creates a dedicated Google Sheet for the app and returns a one-time `api_key` and the `spreadsheet_id`. Store both — the key won't be shown again.

### Query data

```bash
curl https://your-domain/api/my-app/Sheet1 \
  -H "Authorization: Bearer gsdb_xxxx"

# With a SQL filter
curl "https://your-domain/api/my-app/Sheet1?q=SELECT%20*%20WHERE%20A%3D'Alice'" \
  -H "Authorization: Bearer gsdb_xxxx"
```

### Append a row

```bash
curl -X POST https://your-domain/api/my-app/Sheet1 \
  -H "Authorization: Bearer gsdb_xxxx" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Alice", "email": "alice@example.com" }'
```

### OpenAPI schema

`GET /openapi.json` — paste this URL into any LLM or API client to get full interactive access.  
`GET /docs` — Swagger UI.
