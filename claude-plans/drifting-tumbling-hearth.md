# gsdb Dashboard UI Rebuild

## Context

The gsdb admin dashboard at `/ui` is currently broken and limited:

1. **The "+ Create App" button has no `onclick` handler** — it does nothing. There is no way to register an app from the UI.
2. **App cards are dead** — they show `app_id` and `spreadsheet_id` but have no way to reveal/copy the API key, rotate it, navigate into the app's data, or delete the app.
3. **No per-app view** — once an app exists, the dashboard offers no way to inspect its tables, schemas, or rows. The user has to drop into Swagger UI to do anything.
4. **The `renderApps` function in Dashboard.tsx interpolates `app.app_id` and `app.spreadsheet_id` directly into `innerHTML` via a template literal** — XSS risk if an `app_id` ever contains markup.
5. **The `AppCard.tsx` component is unused** — the dashboard bypasses it and renders cards inline.

The user has approved three concrete changes:
- **Fix the Create App button** end-to-end and show the new key once with a copy button.
- **Manage API keys** — "Reveal" a key on an existing app by calling `/rotate` and showing the result with a confirmation warning that the old key will stop working.
- **Per-app view** — list tables, drill into a table to see columns + rows (read-only), and a "Manage schema" mode to add/rename/remove columns.

All backend endpoints already exist (`POST /manage/apps`, `POST /manage/apps/{id}/rotate`, `DELETE /manage/apps/{id}`, `GET|POST /api/{app_id}/tables`, `GET|PUT|PATCH /api/{app_id}/{table}/schema`, `GET|POST /api/{app_id}/{table}`, `PATCH|DELETE /api/{app_id}/{table}/{row}`). No backend changes are required.

## Approach

Add new server-rendered Hono JSX pages (matching the existing `/ui` pattern) and a small set of reusable modal/page components. Wire them up via two new routes in `src/routes/ui.tsx`. Use `sessionStorage` keyed by `gsdb_api_key:<app_id>` to hold the api_key for per-app data calls (the admin secret stays in `localStorage` as today — different trust level, different lifetime). Fix the `renderApps` XSS by escaping all interpolated values.

Server-rendered routes (rather than hash-routed SPA) match the existing `Layout.tsx` + `jsxRenderer` pattern in `src/routes/ui.tsx`, give us bookmarkable URLs, and avoid building a client router.

## Critical files

**New:**
- `src/ui/components/Modal.tsx` — generic modal primitive (backdrop + panel + title + body + buttons). Replaces the hardcoded `adminModal` / `modalBackdrop` ID scheme in `AdminSecretModal.tsx` for new modals.
- `src/ui/components/ConfirmDialog.tsx` — destructive-action confirmation (Delete, Rotate, Remove column).
- `src/ui/components/PromptDialog.tsx` — single-input modal (app_id on create, new column name, new column name on rename).
- `src/ui/components/AppKeyModal.tsx` — captures the api_key for an app; pre-fills from sessionStorage.
- `src/ui/components/KeyRevealModal.tsx` — shows an api_key once after create or rotate, with copy button + warning.
- `src/ui/pages/AppDetail.tsx` — per-app view: tables list, create-table input, rotate/delete buttons, key entry.
- `src/ui/pages/TableView.tsx` — single-table view: columns, rows (read-only), Manage-schema mode (add/rename/remove column).
- `src/ui/lib/escape.ts` — `esc()` helper for client-side HTML escaping used by every render function.

**Modified:**
- `src/ui/components/AppCard.tsx` — add an "Open →" link to `/ui/apps/{app_id}` so the card is a real navigation target.
- `src/ui/pages/Dashboard.tsx` — wire the Create App flow, replace the broken `renderApps` HTML template with an escaped version that produces the same DOM shape as `AppCard`, mount `<CreateAppModal>` and `<KeyRevealModal>`.
- `src/routes/ui.tsx` — register `GET /apps/:app_id` → `AppDetail` and `GET /apps/:app_id/:table` → `TableView`.

**Untouched on this pass** (to avoid regression; can be a follow-up):
- `src/ui/components/AdminSecretModal.tsx` — still works. New modals use the generic `Modal` instead.
- `src/ui/components/Layout.tsx` — already exposes the design tokens we need.

## Patterns and utilities to reuse

- `Layout.tsx` (`src/ui/components/Layout.tsx`) — HTML shell with CSS variables (`--accent`, `--surface`, `--border`, `--text`, `--muted`, `--font`, `--mono`). Every new page wraps in `<Layout title="...">`.
- `AdminSecretModal` (`src/ui/components/AdminSecretModal.tsx`) — established modal pattern (backdrop + panel + `onkeypress` Enter submit + `<div id="modalError">` for inline errors). The new `Modal` component encodes the same shape but parameterizes the IDs from an `id` prop.
- `appAuthMiddleware` (`src/middleware/auth.ts:33`) — server-side check; the UI just needs to attach `Authorization: Bearer` to `/api/{app_id}/*` requests.
- `adminAuthMiddleware` (`src/middleware/auth.ts:65`) — already used by the Dashboard's `window.fetch` wrapper to inject `X-Admin-Secret` on `/manage/*`.
- `renderApps` template — kept as a *template* (renamed `renderAppCardHtml`) but every interpolation goes through `esc()` to fix the XSS.

## Detailed design

### `Modal.tsx` (new)

Generic primitive. Renders two divs: `{id}Backdrop` and `{id}Modal` (id-prefixed so multiple modals can coexist). The existing `AdminSecretModal` uses hardcoded `adminModal` / `modalBackdrop` / `secretInput` / `modalError` — the new pattern prefixes every ID with the modal's `id` prop. Props: `id`, `title`, `body: JSX.Element | string`, `primaryLabel`, `primaryOnClick: string` (global JS function name — same convention as `AdminSecretModal`), `secondaryLabel?`, `secondaryOnClick?`, `width?` (default 400). Inline-style pattern matches the existing dashboard. No `Esc`-to-close in v1 (avoids hijacking the AdminSecretModal's keys); a follow-up can add it.

### `ConfirmDialog.tsx` (new)

Thin wrapper over `Modal` with a single paragraph body and one primary button. `dangerous?: boolean` switches the primary button color from `--accent` to `--danger`. Used for: rotate key (warns old key stops working), delete app, remove column (warns data is lost).

### `PromptDialog.tsx` (new)

Wraps `Modal` with a labeled `<input>` and submit handler that reads `{id}Input.value` and calls `window[submitFn](value)`. `initialValue?: string` supports rename flows. Used for: create app (app_id), create table (table name), add column (column name), rename column (new name).

### `AppKeyModal.tsx` (new)

Single-input modal for the app api_key. Pre-fills from `sessionStorage.getItem('gsdb_api_key:' + app_id)`. Submit → `sessionStorage.setItem(...)` then `window.location.reload()` to re-run page init with the key present. On any 401/403 from a `/api/{app_id}/*` fetch, JS clears the session entry and re-shows this modal.

### `KeyRevealModal.tsx` (new)

Displays the api_key in a `<code>` block with a copy button. The key is interpolated into the modal HTML via `JSON.stringify` at server-render time, so the value is rendered once into the page and lives only in browser memory. "Done" closes the modal; on the rotate flow it also writes the new key to sessionStorage so the page keeps working.

### `AppDetail.tsx` (new)

Server-rendered page. Header with back link, app name, spreadsheet link, and (admin-only) rotate/delete buttons. `+ Create table` input that POSTs to `/api/{app_id}/tables`. Tables list rendered as a grid of `<a href="/ui/apps/{app_id}/{table}">` cards. Mounts `AppKeyModal`, `ConfirmDialog` for rotate, `ConfirmDialog` for delete. Inline `<script>` defines `loadTables()`, `createTable()`, `rotateApp()`, `deleteApp()`, plus the fetch wrapper (extending Dashboard's pattern to also inject `Authorization: Bearer` for `/api/{app_id}/*`).

### `TableView.tsx` (new)

Server-rendered page. Header with back link, table name, and a "Manage schema" toggle button. Two sections: Columns (badges with `Rename` / `Remove` buttons visible only in manage mode, plus an "Add column" input in manage mode) and Rows (read-only HTML table; cell values use `textContent`, not `innerHTML`, to avoid XSS on user-controlled data). Inline `<script>` defines `loadSchema()`, `loadRows()`, `toggleManage()`, `addColumn()`, `renameColumn(from,to)`, `removeColumn(name)`. Mounts `AppKeyModal`, `PromptDialog` for add/rename, `ConfirmDialog` for remove. `loadRows()` is limited to the first 50 rows with a "showing N of M" footer — large sheets render fast and stay readable.

### `escape.ts` (new)

```ts
export function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Used by every `render*` function that builds HTML strings for `innerHTML`.

### `AppCard.tsx` (modify)

Add an "Open →" link to `/ui/apps/{app_id}` in the card's `actionsStyle` row. Keep the rest of the structure and styles. The Dashboard's new `renderAppCardHtml` produces HTML matching this JSX shape (escaped), so cards look the same in both places.

### `Dashboard.tsx` (modify)

Three changes:

1. **Wire Create App.** `<button onclick="openCreateAppModal()">+ Create App</button>` replaces the dead button. `openCreateAppModal` shows `<PromptDialog id="createApp">` (input: app_id, submit: `submitCreateApp`). `submitCreateApp` POSTs to `/manage/apps`, hides the prompt, then shows `<KeyRevealModal id="createAppKey">` with the response. "Done" hides the modal and `loadApps()` re-fetches the list.

2. **Fix `renderApps` XSS.** Rename the existing `renderApps` to `renderAppCardHtml(app): string`. Build the same DOM shape as `<AppCard>` but as a template literal with `esc()` on every interpolation. Keep the empty-state branch.

3. **Mount new modals.** Add `<PromptDialog id="createApp">` and `<KeyRevealModal id="createAppKey">` next to the existing `<AdminSecretModal>`.

### `src/routes/ui.tsx` (modify)

Register two new routes inside `uiRouter`:

```ts
uiRouter.get('/apps/:app_id', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(<AppDetail app_id={c.req.param('app_id')} baseUrl={baseUrl} />);
});

uiRouter.get('/apps/:app_id/:table', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(
    <TableView
      app_id={c.req.param('app_id')}
      table={c.req.param('table')}
      baseUrl={baseUrl}
    />
  );
});
```

These are HTML pages, not OpenAPI routes — plain `uiRouter.get(...)` (no `createRoute`). No change to `src/index.ts` needed (the router is already mounted at `/ui`).

## Pitfalls / decisions to surface

- **XSS in `renderApps`**: today's `${app.app_id}` is interpolated raw. Fixed by the `esc()` wrapper.
- **XSS in row cells**: rows from `/api/{app_id}/{table}` contain user data. `renderRows` must use `textContent` (or escape), never `innerHTML`.
- **App key on first load**: if no key in sessionStorage, show `AppKeyModal` immediately — do NOT call `/api/.../tables` and flash an empty state.
- **Rotation invalidates the in-tab key**: `rotateApp()` must write the new key to `sessionStorage` *before* showing the key reveal modal, so the page keeps working after rotation.
- **Modal ID collisions**: `AdminSecretModal` owns `adminModal` / `modalBackdrop` / `secretInput` / `modalError`. New modals must use `{id}`-prefixed IDs and not reuse these.
- **Inline script interpolation**: putting server-side values (like `app_id`) into a `<script>` body must use `JSON.stringify(...)` — it escapes `</script>` and quote characters safely.
- **Fetch wrapper duplication**: the new pages need the same `X-Admin-Secret` injection pattern plus a new `Authorization: Bearer` branch. Copy-paste between Dashboard and AppDetail/TableView is acceptable for now (inline scripts aren't modules). Mark as tech debt for a follow-up that extracts a shared string.
- **No 404 page**: invalid `app_id` in URL still renders the page, then `loadTables()` returns 403. Handle in JS by showing the error banner + back link. Skip server-side 404 check for v1.
- **`createRoute` for the new UI routes**: do NOT use `createRoute` — these are HTML pages, not API routes. Plain `uiRouter.get(...)` matches the existing `/` route.

## Verification

End-to-end manual checks after implementation:

1. **Create app flow**: open `/ui`, enter admin secret, click "+ Create App", enter `app_id`, see key modal with copyable key, click Done → new card appears in list.
2. **App detail (key entry)**: click the new card's "Open →" link → `AppKeyModal` shows → enter the key from step 1 → tables list loads.
3. **Create table**: enter a table name in `+ Create table` → table appears in the list.
4. **Table view (read-only)**: click a table → columns and rows render, no XSS even on values containing `<`, `>`, `"`.
5. **Manage schema**: click "Manage schema" → add/rename/remove column controls appear → add a column → schema refreshes, rows re-render with the new column → remove a column → ConfirmDialog → schema refreshes.
6. **Rotate key**: from app detail, click "Rotate API key" → ConfirmDialog warns old key stops working → confirm → KeyRevealModal shows new key → close → page still works (sessionStorage updated).
7. **Delete app**: from app detail, click "Delete app" → ConfirmDialog → confirm → redirect to `/ui` → app is gone.
8. **Refresh / bookmark**: bookmark `/ui/apps/foo/bar` and reopen in a fresh tab — key is in sessionStorage so the page renders without re-prompting.
9. **Typecheck**: `bun run typecheck` must pass.

`★ Insight ─────────────────────────────────────`
- **The big learning from this codebase**: Hono JSX has no client-side router, but it doesn't need one — the `Layout` + `jsxRenderer` pattern is a per-request server render, so each "page" is just another `uiRouter.get(path, ...)` route. The HTML shell + inline `<script>` block is enough for a self-contained, navigable UI.
- **The admin secret lives in `localStorage` and the api_key in `sessionStorage` for a reason**: the admin secret is a long-lived deployment credential (rare rotation, multiple tabs), while the api_key is per-app and tab-scoped. Mixing them in one store would make logout or rotation act on the wrong scope.
- **The unused `AppCard.tsx` is a tell**: when a component is imported but not rendered, the codebase has drifted. The fix here is to either use it or delete it. We're going to use it (or rather, mirror its shape in the JS template) so the visual identity of the app list converges on one source of truth.
`─────────────────────────────────────────────────`
