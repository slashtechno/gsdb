import type { Env, AppRecord } from '../types';

// Internal GViz response types — Google's undocumented JSONP API
interface GVizCol { label?: string; id: string; }
interface GVizCell { v?: string | number | boolean | null; }
interface GVizResponse { table: { cols: GVizCol[]; rows: { c: GVizCell[] }[] }; }
interface TokenResponse { access_token: string; error?: string; }

// Sheets API raw values response
interface SheetValuesResponse { values?: string[][]; }

const MASTER_TAB = 'Apps';
const MASTER_HEADERS = ['app_id', 'spreadsheet_id', 'api_key_hash', 'created_at'];

export class GoogleClient {
  // Mints a short-lived access token from the stored refresh token.
  // The refresh token lives as GOOGLE_REFRESH_TOKEN in your Vercel env vars.
  static async getAccessToken(env: Env['Bindings']): Promise<string> {
    if (!env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('GOOGLE_REFRESH_TOKEN is not set. Visit /auth/login to obtain one.');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });

    const data = (await res.json()) as TokenResponse;
    if (data.error) throw new Error(`Token refresh failed: ${data.error}`);
    return data.access_token;
  }

  // Queries a user's spreadsheet tab using the GViz SQL dialect.
  // Google wraps the response in a /*O_o*/ JSONP guard that we strip before parsing.
  static async query(
    env: Env['Bindings'],
    sheetId: string,
    tab: string,
    sql: string
  ): Promise<Record<string, unknown>[]> {
    const token = await this.getAccessToken(env);
    const url =
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
      `?sheet=${encodeURIComponent(tab)}&tq=${encodeURIComponent(sql)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Sheets query failed: ${res.status}`);

    const text = await res.text();
    // Strip the JSONP wrapper before parsing
    const json = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(json) as GVizResponse;

    const cols = data.table.cols.map((c) => c.label || c.id);
    return data.table.rows.map((row) => {
      const item: Record<string, unknown> = {};
      row.c.forEach((cell, i) => { if (cols[i]) item[cols[i]] = cell?.v ?? null; });
      return item;
    });
  }

  // Appends rows to a user spreadsheet tab.
  static async append(
    env: Env['Bindings'],
    sheetId: string,
    range: string,
    values: unknown[][]
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/` +
      `${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets append failed: ${res.status}`);
  }

  // Creates a new Google Spreadsheet and returns its spreadsheetId.
  // Called with an access_token directly (not env) so it works before GOOGLE_REFRESH_TOKEN is set.
  static async createSpreadsheet(accessToken: string, title: string, firstTabName?: string): Promise<string> {
    const body: Record<string, unknown> = { properties: { title } };
    if (firstTabName) body.sheets = [{ properties: { title: firstTabName } }];

    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create spreadsheet: ${res.status}`);
    const data = (await res.json()) as { spreadsheetId: string };
    return data.spreadsheetId;
  }

  // ── Master Sheet (app registry) operations ──────────────────────────────

  // Reads all registered apps from the Master Sheet.
  // Row 1 is headers; subsequent rows are app records.
  static async getMasterSheetApps(env: Env['Bindings']): Promise<AppRecord[]> {
    const token = await this.getAccessToken(env);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to read Master Sheet: ${res.status}`);

    const data = (await res.json()) as SheetValuesResponse;
    const rows = data.values ?? [];
    // rows[0] is headers — skip it; map remaining rows to AppRecord
    return rows.slice(1)
      .filter((r) => r[0]) // skip blank rows
      .map((r) => ({
        app_id: r[0] ?? '',
        spreadsheet_id: r[1] ?? '',
        api_key_hash: r[2] ?? '',
        created_at: r[3] ?? '',
      }));
  }

  // Appends a single app record to the Master Sheet.
  // If the sheet is empty, writes the header row first.
  static async appendMasterSheetApp(env: Env['Bindings'], app: AppRecord): Promise<void> {
    const token = await this.getAccessToken(env);

    // Check if sheet has headers yet
    const checkUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}!A1`;
    const checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}` } });
    const checkData = (await checkRes.json()) as SheetValuesResponse;

    const needsHeaders = !checkData.values?.length;
    const appendRows = needsHeaders
      ? [MASTER_HEADERS, [app.app_id, app.spreadsheet_id, app.api_key_hash, app.created_at]]
      : [[app.app_id, app.spreadsheet_id, app.api_key_hash, app.created_at]];

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}:append?valueInputOption=RAW`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: appendRows }),
    });
    if (!res.ok) throw new Error(`Failed to append to Master Sheet: ${res.status}`);
  }

  // Overwrites the Master Sheet with the given app list (used for delete & key rotation).
  // Clears first to remove any rows that are no longer present.
  static async rewriteMasterSheetApps(env: Env['Bindings'], apps: AppRecord[]): Promise<void> {
    const token = await this.getAccessToken(env);
    const baseUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}`;

    // Clear the sheet
    await fetch(`${baseUrl}:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (apps.length === 0) return;

    // Write headers + all rows
    const values = [
      MASTER_HEADERS,
      ...apps.map((a) => [a.app_id, a.spreadsheet_id, a.api_key_hash, a.created_at]),
    ];

    const res = await fetch(`${baseUrl}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: MASTER_TAB, values }),
    });
    if (!res.ok) throw new Error(`Failed to rewrite Master Sheet: ${res.status}`);
  }
}
