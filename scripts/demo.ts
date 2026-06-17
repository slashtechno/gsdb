/**
 * End-to-end demo of gsdb. Exercises every API surface and tears down cleanly.
 *
 * Usage:
 *   bun scripts/demo.ts                         # uses app.fetch() directly — no server needed
 *   BASE_URL=https://your.vercel.app bun scripts/demo.ts  # hit a remote deployment instead
 *
 * Bun auto-loads .env.local, so env vars are available without extra setup.
 * All data created here (one app + one spreadsheet) is deleted at the end.
 * On error, teardown still runs so you don't leave orphaned apps.
 */

import readline from 'readline';
import app from '../src/index';
import type { Env } from '../src/types';

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => { rl.close(); resolve(); });
  });
}

// When BASE_URL is set, calls go over HTTP to that server.
// When unset, calls are dispatched directly into the Hono app (no server required).
const REMOTE_URL = process.env.BASE_URL ?? null;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-secret';

function getBindings(): Env['Bindings'] {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ?? '',
    MASTER_SHEET_ID: process.env.MASTER_SHEET_ID ?? '',
    ADMIN_SECRET: ADMIN_SECRET,
    GDRIVE_FOLDER_ID: process.env.GDRIVE_FOLDER_ID,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };
}

// Use a timestamp suffix so re-runs don't collide if teardown fails
const APP_ID = `demo-${Date.now()}`;
let API_KEY = '';

// ── Request dispatcher ──────────────────────────────────────────────────────

async function call(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<unknown> {
  const url = `${REMOTE_URL ?? 'http://localhost'}${path}`;
  const req = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Dispatch directly into the Hono app (no network) unless a remote URL is set.
  const res = REMOTE_URL
    ? await fetch(req)
    : await app.fetch(req, getBindings());

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return data;
}

const admin = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { 'X-Admin-Secret': ADMIN_SECRET });

const api = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { Authorization: `Bearer ${API_KEY}` });

// ── Teardown ────────────────────────────────────────────────────────────────

async function teardown() {
  sep('teardown');
  try {
    await admin('DELETE', `/manage/apps/${APP_ID}`);
    ok(`deleted app "${APP_ID}" and its spreadsheet from the registry`);
    note('The Google Sheet itself remains in Drive — delete it manually if desired.');
  } catch (err) {
    console.error('  teardown failed:', err);
  }
}

// ── Output helpers ──────────────────────────────────────────────────────────

const SEP = '─'.repeat(52);
const sep = (label: string) => console.log(`\n${SEP.slice(0, 4)} ${label} ${SEP.slice(label.length + 6)}`);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const note = (msg: string) => console.log(`    ${msg}`);

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\ngsdb demo — ${REMOTE_URL ?? 'in-process'}`);
  console.log(SEP);

  try {
    // 1. Register a new app (gsdb creates a dedicated Google Sheet)
    sep('manage');
    const created = await admin('POST', '/manage/apps', { app_id: APP_ID }) as {
      app_id: string; api_key: string; spreadsheet_id: string;
    };
    API_KEY = created.api_key;
    ok(`registered app "${APP_ID}"`);
    note(`spreadsheet: https://docs.google.com/spreadsheets/d/${created.spreadsheet_id}/edit`);

    // 2. List apps (confirm it appears)
    const apps = await admin('GET', '/manage/apps') as { app_id: string }[];
    const found = apps.some((a) => a.app_id === APP_ID);
    ok(`app list contains "${APP_ID}": ${found}`);

    // ── Schema ──────────────────────────────────────────────────────────────
    sep('schema');

    // 3. Initialize columns on a new tab "users"
    const schema1 = await api('PUT', `/api/${APP_ID}/users/schema`, {
      columns: ['name', 'email', 'role'],
    }) as { columns: string[] };
    ok(`columns set: ${JSON.stringify(schema1.columns)}`);
    note('header row is now protected — UI edits will show a warning');

    // 4. Read schema back
    const schema2 = await api('GET', `/api/${APP_ID}/users/schema`) as { columns: string[] };
    ok(`schema read: ${JSON.stringify(schema2.columns)}`);

    // 5. Add a column
    const schema3 = await api('PATCH', `/api/${APP_ID}/users/schema`, {
      op: 'add', name: 'active',
    }) as { columns: string[] };
    ok(`column added: ${JSON.stringify(schema3.columns)}`);

    // ── Row CRUD ────────────────────────────────────────────────────────────
    sep('row CRUD');

    // 6. Append two rows (keys are mapped to header order regardless of JS insertion order)
    await api('POST', `/api/${APP_ID}/users`, { active: 'true', email: 'alice@example.com', name: 'Alice', role: 'admin' });
    await api('POST', `/api/${APP_ID}/users`, { name: 'Bob', email: 'bob@example.com', role: 'user', active: 'true' });
    ok('appended 2 rows (keys intentionally out of header order)');

    // 7. Read all rows (each has _row for targeting)
    type Row = { _row: number; name: string; email: string; role: string; active: string };
    const rows = await api('GET', `/api/${APP_ID}/users`) as Row[];
    ok(`read ${rows.length} rows:`);
    rows.forEach((r) => note(`  [_row ${r._row}] ${r.name} <${r.email}> role=${r.role}`));

    // 8. Partial update — only change one field, others preserved
    const aliceRow = rows.find((r) => r.name === 'Alice')!._row;
    await api('PATCH', `/api/${APP_ID}/users/${aliceRow}`, { role: 'superadmin' });
    ok(`updated _row ${aliceRow}: role → superadmin`);

    // 9. Confirm update
    const after = await api('GET', `/api/${APP_ID}/users`) as Row[];
    const alice = after.find((r) => r.name === 'Alice')!;
    ok(`confirmed: Alice role is now "${alice.role}"`);

    console.log(`\n${SEP}`);
    console.log('Rows are live in the spreadsheet. Press Enter to continue with column/row ops and teardown...');
    await waitForEnter();

    // ── Column ops ──────────────────────────────────────────────────────────
    sep('column ops');

    // 10. Rename a column (header updates; data stays in the same column)
    const schema4 = await api('PATCH', `/api/${APP_ID}/users/schema`, {
      op: 'rename', from: 'role', to: 'access_level',
    }) as { columns: string[] };
    ok(`renamed role → access_level: ${JSON.stringify(schema4.columns)}`);

    // 11. Remove a column (entire column deleted, not just cleared)
    const schema5 = await api('PATCH', `/api/${APP_ID}/users/schema`, {
      op: 'remove', name: 'active',
    }) as { columns: string[] };
    ok(`removed "active": ${JSON.stringify(schema5.columns)}`);

    // 12. Read rows again to see renamed column in keys
    const final = await api('GET', `/api/${APP_ID}/users`) as Record<string, unknown>[];
    ok(`rows after column ops:`);
    final.forEach((r) => note(`  [_row ${r._row}] ${JSON.stringify(r)}`));

    // ── Delete row ──────────────────────────────────────────────────────────
    sep('delete row');

    const bobRow = rows.find((r) => r.name === 'Bob')!._row;
    await api('DELETE', `/api/${APP_ID}/users/${bobRow}`);
    ok(`deleted Bob (_row ${bobRow})`);

    const remaining = await api('GET', `/api/${APP_ID}/users`) as Row[];
    ok(`rows remaining: ${remaining.length} (expected 1)`);

    // ── Key rotation ────────────────────────────────────────────────────────
    sep('key rotation');

    const rotated = await admin('POST', `/manage/apps/${APP_ID}/rotate`) as { api_key: string };
    const oldKey = API_KEY;
    API_KEY = rotated.api_key;
    ok('rotated API key');

    // Old key should now fail
    try {
      await call('GET', `/api/${APP_ID}/users`, undefined, { Authorization: `Bearer ${oldKey}` });
      console.error('  ✗ old key should have been rejected!');
    } catch {
      ok('old key correctly rejected (403)');
    }

    // New key should work
    await api('GET', `/api/${APP_ID}/users`);
    ok('new key accepted');

    console.log(`\n${SEP}`);
    console.log('Demo complete. Inspect the spreadsheet, then press Enter to tear down...');
    await waitForEnter(); // waits for Enter

    await teardown();
    console.log(`\n${SEP}`);
    console.log('Done ✓\n');

  } catch (err) {
    console.error('\n✗', err);
    console.log('\nPress Enter to tear down (or Ctrl+C to leave data intact for inspection)...');
    await waitForEnter();
    await teardown();
    process.exit(1);
  }
}

main();
