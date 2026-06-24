import type { Env, AppRecord } from '../types';

// Internal GViz response types — Google's undocumented JSONP API
interface GVizCol { label?: string; id: string; }
interface GVizCell { v?: string | number | boolean | null; }
interface GVizResponse { table: { cols: GVizCol[]; rows: { c: GVizCell[] }[] }; }
interface TokenResponse { access_token: string; error?: string; }

// Sheets API raw values response
interface SheetValuesResponse { values?: string[][]; }

// Thrown when the Sheets API returns 429. Callers should surface this as a 429
// to their own clients and pass through retryAfter when present.
export class RateLimitError extends Error {
  readonly retryAfter: number | null;
  constructor(retryAfter: number | null) {
    super('Google Sheets API rate limit exceeded');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// Checks a Sheets API response for 429 and throws RateLimitError before the
// caller tries to parse a JSON body that won't match their expected shape.
function assertNotRateLimited(res: globalThis.Response): void {
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw new RateLimitError(retryAfter ? Number(retryAfter) : null);
  }
}

const MASTER_TAB = 'Apps';
const MASTER_HEADERS = ['app_id', 'spreadsheet_id', 'api_key_hash', 'created_at'];

export class GoogleClient {
  // Mints a short-lived access token from the stored refresh token.
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

    if (!res.ok) {
      console.error('getAccessToken failed:', { status: res.status, statusText: res.statusText });
    }

    const data = (await res.json()) as TokenResponse;
    if (data.error) {
      console.error('getAccessToken error from Google:', { error: data.error });
      throw new Error(`Token refresh failed: ${data.error}`);
    }
    return data.access_token;
  }

  // Queries a user's spreadsheet tab using the GViz SQL dialect.
  // Accepts header names in SQL (e.g., "SELECT name, email WHERE role = 'admin'") and
  // translates them to column letters (A, B, C...) for the GViz API.
  // Does NOT return _row — GViz has no row-number function and loading the full sheet
  // to match back would be O(n) per query. Use GET /{table} when you need _row.
  static async query(
    env: Env['Bindings'],
    sheetId: string,
    tab: string,
    sql: string
  ): Promise<Record<string, unknown>[]> {
    const token = await this.getAccessToken(env);

    // Fetch headers to map names to column letters
    const headers = await this.fetchHeaders(token, sheetId, tab);
    if (headers.length === 0) {
      throw new Error('Table has no headers');
    }

    // Translate header names to column letters in the SQL
    let translatedSql = sql;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const colLetter = this.colLetter(i + 1);
      // Replace header name (case-insensitive, word boundary) with column letter
      const regex = new RegExp(`\\b${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      translatedSql = translatedSql.replace(regex, colLetter);
    }

    const url =
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
      `?sheet=${encodeURIComponent(tab)}&headers=1&tq=${encodeURIComponent(translatedSql)}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Sheets query failed: ${res.status}`);

    const text = await res.text();
    const json = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(json) as GVizResponse;

    // Use data.table.cols[i].label for column names — correct when SELECT projects
    // a subset of columns (cols[i] reflects the actual returned columns, not all headers).
    return data.table.rows.map((row) => {
      const item: Record<string, unknown> = {};
      row.c.forEach((cell, i) => {
        const label = data.table.cols[i]?.label;
        if (label) item[label] = cell?.v ?? null;
      });
      return item;
    });
  }

  // Appends raw rows to a spreadsheet range (used internally for the master sheet).
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
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Sheets append failed: ${res.status}`);
  }

  // Appends multiple record rows in a single Sheets API call.
  // All rows are mapped to the same header order; unknown keys are ignored, missing keys become null.
  static async appendRows(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    records: Record<string, unknown>[]
  ): Promise<void> {
    if (records.length === 0) return;
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);

    const values = records.map((record) =>
      headers.length > 0
        ? headers.map((h) => record[h] !== undefined ? record[h] : null)
        : Object.values(record)
    );

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/` +
      `${encodeURIComponent(tab)}:append?valueInputOption=RAW`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Sheets batch append failed: ${res.status}`);
  }

  // Updates multiple rows in a single values.batchUpdate call.
  // patches: array of { _row, ...fields } — _row is 1-indexed data row number.
  // Reads all current rows once, merges each patch, then writes all in one request.
  static async batchUpdateRows(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    patches: Array<{ _row: number } & Record<string, unknown>>
  ): Promise<void> {
    if (patches.length === 0) return;
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);
    const colEnd = this.colLetter(headers.length);

    // Fetch all current rows in one call, build a map from _row → current cell values
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(readRes);
    if (!readRes.ok) throw new Error(`Failed to read rows for batch update: ${readRes.status}`);
    const readData = (await readRes.json()) as SheetValuesResponse;
    const allRows = readData.values ?? [];

    // Build valueRanges: one entry per patch, merged with existing row data
    const data = patches.map(({ _row, ...patch }) => {
      const sheetRow = _row + 1; // +1 for header
      const current = allRows[_row] ?? []; // allRows[0] is header, allRows[_row] is data row _row
      const record: Record<string, unknown> = {};
      headers.forEach((h, i) => { record[h] = current[i] ?? null; });
      Object.assign(record, patch);
      return {
        range: `${tab}!A${sheetRow}:${colEnd}${sheetRow}`,
        values: [headers.map((h) => record[h] ?? null)],
      };
    });

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Sheets batch update failed: ${res.status}`);
  }

  // Appends a single record row to a user tab, mapping values to existing column headers.
  // If the tab has no headers yet, values are inserted in key-insertion order.
  static async appendRow(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    record: Record<string, unknown>
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);

    const row = headers.length > 0
      ? headers.map((h) => record[h] !== undefined ? record[h] : null)
      : Object.values(record);

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/` +
      `${encodeURIComponent(tab)}:append?valueInputOption=RAW`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Sheets append failed: ${res.status}`);
  }

  // Reads all data rows from a tab via the values API. Returns named objects with a _row field
  // (1-indexed API row number; row 1 = sheet row 2 because row 1 is the header).
  static async getRows(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string
  ): Promise<{ _row: number; [key: string]: unknown }[]> {
    const token = await this.getAccessToken(env);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) {
      if (res.status === 400) throw new Error(`Tab "${tab}" not found`);
      throw new Error(`Sheets read failed: ${res.status}`);
    }

    const data = (await res.json()) as SheetValuesResponse;
    const rows = data.values ?? [];
    if (rows.length < 2) return []; // only header or empty

    const headers = rows[0].map(String);
    return rows.slice(1).map((row, i) => {
      const record: { _row: number; [key: string]: unknown } = { _row: i + 1 };
      headers.forEach((h, j) => { record[h] = row[j] ?? null; });
      return record;
    });
  }

  // Lists all tab names in a spreadsheet.
  static async listTabs(env: Env['Bindings'], spreadsheetId: string): Promise<string[]> {
    const token = await this.getAccessToken(env);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to list tabs: ${res.status}`);
    const data = (await res.json()) as { sheets: { properties: { title: string } }[] };
    return data.sheets.map((s) => s.properties.title);
  }

  // Creates a new tab (sub-sheet) in the spreadsheet.
  static async createTab(env: Env['Bindings'], spreadsheetId: string, tab: string): Promise<void> {
    const token = await this.getAccessToken(env);
    await this.ensureTab(token, spreadsheetId, tab);
  }

  // Deletes a tab (sub-sheet) from the spreadsheet.
  static async deleteTab(env: Env['Bindings'], spreadsheetId: string, tab: string): Promise<void> {
    const token = await this.getAccessToken(env);
    const tabId = await this.fetchTabId(token, spreadsheetId, tab);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ deleteSheet: { sheetId: tabId } }],
        }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to delete tab: ${res.status}`);
  }

  // Returns the header row (row 1) of a tab.
  static async getHeaders(env: Env['Bindings'], spreadsheetId: string, tab: string): Promise<string[]> {
    const token = await this.getAccessToken(env);
    return this.fetchHeaders(token, spreadsheetId, tab);
  }

  // Sets (overwrites) the header row and adds a warning-only protection on it.
  // Creates the tab if it doesn't already exist.
  static async setHeaders(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    headers: string[]
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    await this.ensureTab(token, spreadsheetId, tab);
    await this.writeHeaders(token, spreadsheetId, tab, headers);
    // Protect the header row so UI edits show a warning (API writes are never blocked)
    await this.protectHeaderRow(token, spreadsheetId, tab);
  }

  // Adds a new column at the end of the header row.
  static async addColumn(env: Env['Bindings'], spreadsheetId: string, tab: string, name: string): Promise<void> {
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);
    if (headers.includes(name)) throw new Error(`Column "${name}" already exists`);
    await this.writeHeaders(token, spreadsheetId, tab, [...headers, name]);
  }

  // Renames a column header in place (data rows keep their positions).
  static async renameColumn(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    from: string,
    to: string
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);
    const idx = headers.indexOf(from);
    if (idx === -1) throw new Error(`Column "${from}" not found`);
    if (headers.includes(to)) throw new Error(`Column "${to}" already exists`);
    const updated = [...headers];
    updated[idx] = to;
    await this.writeHeaders(token, spreadsheetId, tab, updated);
  }

  // Deletes an entire column (header + all data) — shifts subsequent columns left.
  static async deleteColumn(env: Env['Bindings'], spreadsheetId: string, tab: string, name: string): Promise<void> {
    const token = await this.getAccessToken(env);
    const [headers, tabId] = await Promise.all([
      this.fetchHeaders(token, spreadsheetId, tab),
      this.fetchTabId(token, spreadsheetId, tab),
    ]);
    const idx = headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found`);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
            },
          }],
        }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to delete column: ${res.status}`);
  }

  // Updates a specific data row (patch semantics — only supplied fields are changed).
  // row is 1-indexed (row 1 = first data row after the header).
  static async updateRow(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    row: number,
    patch: Record<string, unknown>
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    const headers = await this.fetchHeaders(token, spreadsheetId, tab);
    const sheetRow = row + 1; // +1 for header

    // Read the current row values
    const colEnd = this.colLetter(headers.length);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}!A${sheetRow}:${colEnd}${sheetRow}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!readRes.ok) throw new Error(`Failed to read row ${row}: ${readRes.status}`);
    const readData = (await readRes.json()) as SheetValuesResponse;
    const current = readData.values?.[0] ?? [];

    // Build merged record
    const record: Record<string, unknown> = {};
    headers.forEach((h, i) => { record[h] = current[i] ?? null; });
    Object.assign(record, patch);

    const writeRange = `${tab}!A${sheetRow}`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}!A${sheetRow}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: writeRange, values: [headers.map((h) => record[h] ?? null)] }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to update row ${row}: ${res.status}`);
  }

  // Deletes a specific data row, shifting subsequent rows up.
  // row is 1-indexed (row 1 = first data row after the header).
  static async deleteRow(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    row: number
  ): Promise<void> {
    const token = await this.getAccessToken(env);
    const tabId = await this.fetchTabId(token, spreadsheetId, tab);
    const sheetRow = row + 1; // +1 for header; batchUpdate uses 0-indexed

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId: tabId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow },
            },
          }],
        }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to delete row ${row}: ${res.status}`);
  }

  // Deletes multiple rows in one batchUpdate. Requests are sorted highest-index-first so earlier
  // deletes don't shift the indices of later ones (Sheets processes requests sequentially).
  static async deleteRows(
    env: Env['Bindings'],
    spreadsheetId: string,
    tab: string,
    rows: number[]
  ): Promise<void> {
    if (rows.length === 0) return;
    const token = await this.getAccessToken(env);
    const tabId = await this.fetchTabId(token, spreadsheetId, tab);
    const sorted = [...rows].sort((a, b) => b - a);
    const requests = sorted.map((row) => {
      const sheetRow = row + 1;
      return {
        deleteDimension: {
          range: { sheetId: tabId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow },
        },
      };
    });
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to delete rows: ${res.status}`);
  }

  // Moves a spreadsheet into a Drive folder. Called after createSpreadsheet when GDRIVE_FOLDER_ID is set.
  // Uses the access_token directly so it works with a freshly obtained token before storing it.
  static async moveToFolder(accessToken: string, spreadsheetId: string, folderId: string): Promise<void> {
    // Fetch current parents so we can remove them (a file can only have one parent in Drive)
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=parents`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const meta = (await metaRes.json()) as { parents?: string[] };
    const removeParents = (meta.parents ?? []).join(',');

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}`);
    url.searchParams.set('addParents', folderId);
    if (removeParents) url.searchParams.set('removeParents', removeParents);
    url.searchParams.set('fields', 'id,parents');

    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to move spreadsheet to folder: ${res.status}`);
  }

  // Deletes a Google Spreadsheet from Drive.
  static async deleteSpreadsheet(accessToken: string, spreadsheetId: string): Promise<void> {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to delete spreadsheet: ${res.status}`);
  }

  // Creates a new Google Spreadsheet and returns its spreadsheetId.
  static async createSpreadsheet(accessToken: string, title: string, firstTabName?: string): Promise<string> {
    const body: Record<string, unknown> = { properties: { title } };
    if (firstTabName) body.sheets = [{ properties: { title: firstTabName } }];

    const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to create spreadsheet: ${res.status}`);
    const data = (await res.json()) as { spreadsheetId: string };
    return data.spreadsheetId;
  }

  // ── Master Sheet (app registry) operations ──────────────────────────────

  static async getMasterSheetApps(env: Env['Bindings']): Promise<AppRecord[]> {
    const token = await this.getAccessToken(env);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assertNotRateLimited(res);
    if (!res.ok) {
      console.error('getMasterSheetApps failed:', { status: res.status, url });
      throw new Error(`Failed to read Master Sheet: ${res.status}`);
    }

    const data = (await res.json()) as SheetValuesResponse;
    const rows = data.values ?? [];
    return rows.slice(1)
      .filter((r) => r[0])
      .map((r) => ({
        app_id: r[0] ?? '',
        spreadsheet_id: r[1] ?? '',
        api_key_hash: r[2] ?? '',
        created_at: r[3] ?? '',
      }));
  }

  static async appendMasterSheetApp(env: Env['Bindings'], app: AppRecord): Promise<void> {
    const token = await this.getAccessToken(env);

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
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to append to Master Sheet: ${res.status}`);
  }

  static async rewriteMasterSheetApps(env: Env['Bindings'], apps: AppRecord[]): Promise<void> {
    const token = await this.getAccessToken(env);
    const baseUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${env.MASTER_SHEET_ID}` +
      `/values/${MASTER_TAB}`;

    await fetch(`${baseUrl}:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (apps.length === 0) return;

    const values = [
      MASTER_HEADERS,
      ...apps.map((a) => [a.app_id, a.spreadsheet_id, a.api_key_hash, a.created_at]),
    ];

    const res = await fetch(`${baseUrl}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: MASTER_TAB, values }),
    });
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to rewrite Master Sheet: ${res.status}`);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  // Converts a 1-indexed column number to a letter (1→A, 26→Z, 27→AA …)
  private static colLetter(n: number): string {
    let s = '';
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  // Creates a tab in the spreadsheet if it does not already exist.
  // If the spreadsheet still has Google's default "Sheet1" placeholder, removes it in the same request.
  private static async ensureTab(token: string, spreadsheetId: string, tab: string): Promise<void> {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to get spreadsheet metadata: ${res.status}`);
    const data = (await res.json()) as { sheets: { properties: { title: string; sheetId: number } }[] };
    if (data.sheets.some((s) => s.properties.title === tab)) return;

    const requests: unknown[] = [{ addSheet: { properties: { title: tab } } }];
    const sheet1 = data.sheets.find((s) => s.properties.title === 'Sheet1');
    if (sheet1) requests.push({ deleteSheet: { sheetId: sheet1.properties.sheetId } });

    const addRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    );
    if (!addRes.ok) throw new Error(`Failed to create tab "${tab}": ${addRes.status}`);
  }

  // Returns the numeric sheetId for a named tab (required by batchUpdate operations).
  private static async fetchTabId(token: string, spreadsheetId: string, tab: string): Promise<number> {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to get spreadsheet metadata: ${res.status}`);
    const data = (await res.json()) as { sheets: { properties: { title: string; sheetId: number } }[] };
    const sheet = data.sheets.find((s) => s.properties.title === tab);
    if (!sheet) throw new Error(`Tab "${tab}" not found`);
    return sheet.properties.sheetId;
  }

  // Reads row 1 as an array of column header names.
  private static async fetchHeaders(token: string, spreadsheetId: string, tab: string): Promise<string[]> {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}!1:1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to read headers: ${res.status}`);
    const data = (await res.json()) as SheetValuesResponse;
    return data.values?.[0]?.map(String) ?? [];
  }

  // Writes headers to row 1. Clears row 1 first so removed columns don't linger —
  // PUT only overwrites cells it touches, leaving trailing cells intact without the clear.
  private static async writeHeaders(
    token: string,
    spreadsheetId: string,
    tab: string,
    headers: string[]
  ): Promise<void> {
    const encodedTab = encodeURIComponent(tab);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedTab}!1:1:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );

    const range = `${tab}!1:1`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedTab}!1:1?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, values: [headers] }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to write headers: ${res.status}`);
  }

  // Adds a warningOnly protected range over row 1 to discourage accidental UI edits.
  // warningOnly = true means the API token owner can still write freely; only the UI warns humans.
  private static async protectHeaderRow(token: string, spreadsheetId: string, tab: string): Promise<void> {
    const tabId = await this.fetchTabId(token, spreadsheetId, tab);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            addProtectedRange: {
              protectedRange: {
                range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
                description: 'gsdb header row — managed via API',
                warningOnly: true,
              },
            },
          }],
        }),
      }
    );
    assertNotRateLimited(res);
    if (!res.ok) throw new Error(`Failed to protect header row: ${res.status}`);
  }
}
