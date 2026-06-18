import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const dataRouter = new OpenAPIHono<Env>();

// Shared param schemas
const tableNameParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table_name: z.string().openapi({ example: 'users' }),
});

const rowParams = tableNameParams.extend({
  row: z.coerce.number().int().positive().openapi({ description: '_row index from a GET response', example: 1 }),
});

const columnParams = tableNameParams.extend({
  column_name: z.string().min(1).openapi({ example: 'email' }),
});

// Row object returned by GET (always includes _row)
const RowSchema = z.record(z.unknown()).and(z.object({ _row: z.number() }));

// Table schemas (Google Sheets calls these "tabs", but "tables" is more intuitive for DB users)
const tableParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table: z.string().openapi({ example: 'users' }),
});

const TableListSchema = z.object({ tables: z.array(z.string()) });
const TableCreateSchema = z.object({ table: z.string().min(1).openapi({ example: 'new_table' }) });
const ColumnsSchema = z.object({ columns: z.array(z.string()) });

// ── GET /{table_name}/schema ───────────────────────────────────────────────
// Register /schema BEFORE /{row} so Hono matches the static segment first.
dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'Return column headers for a sheet tab',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableNameParams },
    responses: {
      200: {
        description: 'Column names in order',
        content: { 'application/json': { schema: ColumnsSchema } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── PUT /{table_name}/schema ───────────────────────────────────────────────
// True full-replace: add new columns and delete removed ones (including their data).
dataRouter.openapi(
  createRoute({
    method: 'put',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'Replace all column headers. Columns present in the current schema but absent from this request are permanently deleted along with all their cell data. New columns are appended with empty values. At least one column required.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({
              columns: z.array(z.string().min(1)).min(1).openapi({ example: ['name', 'email', 'role'] }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Schema replaced',
        content: { 'application/json': { schema: ColumnsSchema } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { columns } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    const current = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    const toRemove = current.filter((h) => !columns.includes(h));
    for (const name of toRemove) {
      await GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, name);
    }
    await GoogleClient.setHeaders(c.env, spreadsheetId, table_name, columns);
    return c.json({ columns });
  }
);

// ── POST /{table_name}/schema/columns ─────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{table_name}/schema/columns',
    tags: ['Schema'],
    summary: 'Add a new column to the table. The column is appended after the last existing column with empty values for all existing rows. No existing data is affected.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({ name: z.string().min(1).openapi({ example: 'phone' }) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Column added',
        content: { 'application/json': { schema: ColumnsSchema } },
      },
      400: { description: 'Column already exists' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      await GoogleClient.addColumn(c.env, spreadsheetId, table_name, name);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }

    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── PUT /{table_name}/schema/columns/{column_name} ─────────────────────────
// Rename: PUT replaces the named resource with new state.
dataRouter.openapi(
  createRoute({
    method: 'put',
    path: '/{table_name}/schema/columns/{column_name}',
    tags: ['Schema'],
    summary: 'Rename a column. Only the header label changes — all existing cell data in that column is preserved in place.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: columnParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({ name: z.string().min(1).openapi({ example: 'email_address' }) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Column renamed',
        content: { 'application/json': { schema: ColumnsSchema } },
      },
      400: { description: 'Column not found or name conflict' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, column_name } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      await GoogleClient.renameColumn(c.env, spreadsheetId, table_name, column_name, name);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }

    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── DELETE /{table_name}/schema/columns/{column_name} ─────────────────────
dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{table_name}/schema/columns/{column_name}',
    tags: ['Schema'],
    summary: 'Delete a column and permanently remove all its cell data. Uses a structural column delete (deleteDimension) — the header and its data are removed as one unit, so remaining columns shift left with their data intact (no header-to-data misalignment). Note: any external code referencing columns by letter (A, B, C…) rather than by name will break.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: columnParams },
    responses: {
      200: {
        description: 'Column deleted',
        content: { 'application/json': { schema: ColumnsSchema } },
      },
      400: { description: 'Column not found' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, column_name } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      await GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, column_name);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }

    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── Table CRUD (tabs in Google Sheets) ──────────────────────────────────────────

// GET /tables — List all tables (tabs) in the spreadsheet
dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/tables',
    tags: ['Tables'],
    summary: 'List all tables (tabs) in the spreadsheet',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: z.object({ app_id: z.string() }) },
    responses: {
      200: {
        description: 'List of table names',
        content: { 'application/json': { schema: TableListSchema } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    try {
      const spreadsheetId = c.get('spreadsheet_id');
      const tables = await GoogleClient.listTabs(c.env, spreadsheetId);
      return c.json({ tables });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to list tables' }, 500);
    }
  }
);

// POST /tables — Create a new table (tab)
dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/tables',
    tags: ['Tables'],
    summary: 'Create a new table (tab). Creates the table with no headers; use PUT /{table}/schema to set columns.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: z.object({ app_id: z.string() }),
      body: {
        content: {
          'application/json': { schema: TableCreateSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Table created',
        content: { 'application/json': { schema: z.object({ table: z.string(), message: z.string() }) } },
      },
      400: { description: 'Table already exists' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    try {
      const { table } = c.req.valid('json');
      const spreadsheetId = c.get('spreadsheet_id');
      const existingTables = await GoogleClient.listTabs(c.env, spreadsheetId);
      if (existingTables.includes(table)) {
        return c.json({ error: 'Table already exists' }, 400);
      }
      await GoogleClient.createTab(c.env, spreadsheetId, table);
      return c.json({ table, message: 'Table created successfully' }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create table' }, 500);
    }
  }
);

// DELETE /tables/{table} — Delete a table
dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/tables/{table}',
    tags: ['Tables'],
    summary: 'Delete a table (tab) and all its data. Cannot delete the last remaining table.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableParams },
    responses: {
      200: {
        description: 'Table deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: 'Cannot delete the last table' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
      404: { description: 'Table not found' },
    },
  }),
  async (c) => {
    try {
      const { table } = c.req.valid('param');
      const spreadsheetId = c.get('spreadsheet_id');
      const existingTables = await GoogleClient.listTabs(c.env, spreadsheetId);
      if (!existingTables.includes(table)) {
        return c.json({ error: 'Table not found' }, 404);
      }
      if (existingTables.length <= 1) {
        return c.json({ error: 'Cannot delete the last remaining table' }, 400);
      }
      await GoogleClient.deleteTab(c.env, spreadsheetId, table);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to delete table' }, 500);
    }
  }
);

// ── Query (GViz SQL) ──────────────────────────────────────────────────────────

// Basic SQL validation to prevent potential issues
function validateSql(sql: string): string | null {
  // GViz SQL is read-only, but we can block obviously malicious patterns
  const lower = sql.toLowerCase();
  const dangerous = ['drop', 'delete', 'insert', 'update', 'create', 'alter', 'grant', 'revoke', 'exec', 'execute'];
  for (const word of dangerous) {
    if (lower.includes(word)) return `${word.toUpperCase()} statements are not allowed in GViz SQL`;
  }
  if (!lower.trim().startsWith('select') && lower.trim() !== '') {
    return 'Only SELECT queries are allowed (or empty string for all rows)';
  }
  return null;
}

const queryParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table_name: z.string().openapi({ example: 'users' }),
});

const QuerySchema = z.object({
  sql: z.string().openapi({
    example: "SELECT name, email WHERE role = 'admin'",
    description: 'GViz SQL query using header names (e.g., "name", "email") — automatically translated to column letters. Supports SELECT, WHERE, ORDER BY, LIMIT, OFFSET.'
  }),
});

dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{table_name}/query',
    tags: ['Query'],
    summary: 'Execute a GViz SQL query on a table. Supports SELECT, WHERE, ORDER BY, LIMIT, OFFSET, etc.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: queryParams,
      body: {
        content: {
          'application/json': { schema: QuerySchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Query results. Does not include _row — use GET /{table_name} when you need _row for mutations.',
        content: { 'application/json': { schema: z.object({ rows: z.array(z.record(z.unknown())) }) } },
      },
      400: { description: 'Bad request (invalid SQL or table not found)' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { sql } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    const validationError = validateSql(sql);
    if (validationError) return c.json({ error: validationError }, 400);

    try {
      const rows = await GoogleClient.query(c.env, spreadsheetId, table_name, sql);
      return c.json({ rows });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  }
);

// ── GET /{table_name} ──────────────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}',
    tags: ['Data'],
    summary: 'Read all rows from a sheet tab. Each row includes _row (use this for PATCH/DELETE).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableNameParams },
    responses: {
      200: {
        description: 'Rows with _row indices',
        content: { 'application/json': { schema: z.array(RowSchema) } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    try {
      const { table_name } = c.req.valid('param');
      const spreadsheetId = c.get('spreadsheet_id');
      const rows = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      return c.json(rows);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to read rows' }, 500);
    }
  }
);

// ── POST /{table_name} ─────────────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{table_name}',
    tags: ['Data'],
    summary: 'Append a row. Values are mapped to existing column headers by key name (order-independent).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.record(z.unknown()).openapi({ example: { name: 'Alice', email: 'alice@example.com' } }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Row appended',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    try {
      const { table_name } = c.req.valid('param');
      const body = c.req.valid('json');
      const spreadsheetId = c.get('spreadsheet_id');
      await GoogleClient.appendRow(c.env, spreadsheetId, table_name, body);
      return c.json({ success: true }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to append row' }, 500);
    }
  }
);

// ── Field-based row lookup (/by/{field}/{value}) ───────────────────────────
// These must be registered BEFORE /{row} so Hono matches the static "by" segment first.

const byFieldParams = tableNameParams.extend({
  field: z.string().min(1).openapi({ example: 'id' }),
  value: z.string().openapi({ example: 'user_123' }),
});

// Helper: find rows where row[field] matches value (string comparison).
function matchRows(
  rows: { _row: number; [key: string]: unknown }[],
  field: string,
  value: string
): { _row: number; [key: string]: unknown }[] {
  return rows.filter((r) => String(r[field] ?? '') === value);
}

dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'],
    summary: 'Find all rows where a field equals a value. Returns rows including _row, which can be used for subsequent PATCH or DELETE by row number.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: {
        description: 'Matching rows (may be empty)',
        content: { 'application/json': { schema: z.object({ rows: z.array(RowSchema) }) } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      const all = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      return c.json({ rows: matchRows(all, field, value) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'],
    summary: 'Partially update all rows where a field equals a value. Only supplied fields are changed; others are preserved. Returns the number of rows updated.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: byFieldParams,
      body: {
        content: {
          'application/json': {
            schema: z.record(z.unknown()).openapi({ example: { status: 'active' } }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Rows updated',
        content: { 'application/json': { schema: z.object({ updated: z.number() }) } },
      },
      400: { description: 'Bad request' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    const patch = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      const all = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      const matches = matchRows(all, field, value);
      for (const row of matches) {
        await GoogleClient.updateRow(c.env, spreadsheetId, table_name, row._row, patch);
      }
      return c.json({ updated: matches.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'],
    summary: 'Delete all rows where a field equals a value. Rows are removed highest-index-first to avoid row-shift affecting later deletes. Returns the number of rows deleted.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: {
        description: 'Rows deleted',
        content: { 'application/json': { schema: z.object({ deleted: z.number() }) } },
      },
      400: { description: 'Bad request' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      const all = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      const matches = matchRows(all, field, value);
      await GoogleClient.deleteRows(c.env, spreadsheetId, table_name, matches.map((r) => r._row));
      return c.json({ deleted: matches.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  }
);

// ── PATCH /{table_name}/{row} ──────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{table_name}/{row}',
    tags: ['Data'],
    summary: 'Partially update a row. Only supplied fields are changed; others are preserved.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: rowParams,
      body: {
        content: {
          'application/json': {
            schema: z.record(z.unknown()).openapi({ example: { role: 'admin' } }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Row updated',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: 'Bad request' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, row } = c.req.valid('param');
    const patch = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      await GoogleClient.updateRow(c.env, spreadsheetId, table_name, row, patch);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
    return c.json({ success: true });
  }
);

// ── DELETE /{table_name}/{row} ─────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{table_name}/{row}',
    tags: ['Data'],
    summary: 'Delete a row by its _row index. Subsequent rows shift up (row numbers change).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: rowParams },
    responses: {
      200: {
        description: 'Row deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      400: { description: 'Bad request' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, row } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      await GoogleClient.deleteRow(c.env, spreadsheetId, table_name, row);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
    return c.json({ success: true });
  }
);
