import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const dataRouter = new OpenAPIHono<Env>();

// ── Shared param schemas ───────────────────────────────────────────────────

const tableNameParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table_name: z.string().openapi({ example: 'users' }),
});

const rowParams = tableNameParams.extend({
  row: z.coerce.number().int().positive().openapi({ description: '_row index from a GET response', example: 1 }),
});

const columnParams = tableNameParams.extend({
  column: z.string().min(1).openapi({ example: 'email' }),
});

const byFieldParams = tableNameParams.extend({
  field: z.string().min(1).openapi({ example: 'id' }),
  value: z.string().openapi({ example: 'user_123' }),
});

const tableParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table: z.string().openapi({ example: 'users' }),
});

// ── Shared response schemas ────────────────────────────────────────────────

// Row always includes _row so callers can use it for mutations after a read.
const RowSchema = z.record(z.unknown()).and(z.object({ _row: z.number() }));
const ColumnsSchema = z.object({ columns: z.array(z.string()) });
const TableListSchema = z.object({ tables: z.array(z.string()) });

// ── Schema endpoints ───────────────────────────────────────────────────────
// Register all /schema routes before /{row} so Hono matches the static segment first.

dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'List column headers in order.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableNameParams },
    responses: {
      200: { description: 'Column names', content: { 'application/json': { schema: ColumnsSchema } } },
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

// True full-replace: columns absent from the request are deleted along with their data.
dataRouter.openapi(
  createRoute({
    method: 'put',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'Replace all column headers. Columns absent from this request are permanently deleted along with all their cell data. New columns are appended with empty values.',
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
      200: { description: 'Schema replaced', content: { 'application/json': { schema: ColumnsSchema } } },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { columns } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    const current = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    for (const name of current.filter((h) => !columns.includes(h))) {
      await GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, name);
    }
    await GoogleClient.setHeaders(c.env, spreadsheetId, table_name, columns);
    return c.json({ columns });
  }
);

// POST /{table}/schema/{column} — add a column named by the path segment (no body needed).
dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{table_name}/schema/{column}',
    tags: ['Schema'],
    summary: 'Add a column. Appended after the last existing column with empty values for all existing rows.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: columnParams },
    responses: {
      200: { description: 'Column added', content: { 'application/json': { schema: ColumnsSchema } } },
      400: { description: 'Column already exists' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      await GoogleClient.addColumn(c.env, spreadsheetId, table_name, column);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// PUT /{table}/schema/{column} — rename: replaces the named resource with new state.
dataRouter.openapi(
  createRoute({
    method: 'put',
    path: '/{table_name}/schema/{column}',
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
      200: { description: 'Column renamed', content: { 'application/json': { schema: ColumnsSchema } } },
      400: { description: 'Column not found or name conflict' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      await GoogleClient.renameColumn(c.env, spreadsheetId, table_name, column, name);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{table_name}/schema/{column}',
    tags: ['Schema'],
    summary: 'Delete a column and permanently remove all its cell data. The header and its data are removed as one unit (deleteDimension), so remaining columns shift left with their data intact — no header-to-data misalignment.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: columnParams },
    responses: {
      200: { description: 'Column deleted', content: { 'application/json': { schema: ColumnsSchema } } },
      400: { description: 'Column not found' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    try {
      await GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, column);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── Table CRUD ─────────────────────────────────────────────────────────────

dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/tables',
    tags: ['Tables'],
    summary: 'List all tables (tabs).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: z.object({ app_id: z.string() }) },
    responses: {
      200: { description: 'Table names', content: { 'application/json': { schema: TableListSchema } } },
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

dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/tables',
    tags: ['Tables'],
    summary: 'Create a table (tab) with no headers. Use PUT /{table}/schema to set columns.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: z.object({ app_id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({ table: z.string().min(1).openapi({ example: 'orders' }) }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Table created',
        content: { 'application/json': { schema: z.object({ table: z.string() }) } },
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
      const existing = await GoogleClient.listTabs(c.env, spreadsheetId);
      if (existing.includes(table)) return c.json({ error: 'Table already exists' }, 400);
      await GoogleClient.createTab(c.env, spreadsheetId, table);
      return c.json({ table }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create table' }, 500);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/tables/{table}',
    tags: ['Tables'],
    summary: 'Delete a table and all its data. Cannot delete the last remaining table.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableParams },
    responses: {
      200: { description: 'Table deleted', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
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
      const existing = await GoogleClient.listTabs(c.env, spreadsheetId);
      if (!existing.includes(table)) return c.json({ error: 'Table not found' }, 404);
      if (existing.length <= 1) return c.json({ error: 'Cannot delete the last remaining table' }, 400);
      await GoogleClient.deleteTab(c.env, spreadsheetId, table);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to delete table' }, 500);
    }
  }
);

// ── Data endpoints ─────────────────────────────────────────────────────────

// GViz SQL validation — GViz is read-only by design, but block obvious misuse.
function validateSql(sql: string): string | null {
  const lower = sql.toLowerCase();
  const blocked = ['drop', 'delete', 'insert', 'update', 'create', 'alter', 'grant', 'revoke', 'exec', 'execute'];
  for (const word of blocked) {
    if (lower.includes(word)) return `${word.toUpperCase()} is not allowed in GViz SQL`;
  }
  if (!lower.trim().startsWith('select') && lower.trim() !== '') {
    return 'Only SELECT queries are allowed (or omit sql for all rows)';
  }
  return null;
}

// GET /{table} — all rows. Optional ?sql= runs a GViz query instead (no _row in results).
dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}',
    tags: ['Data'],
    summary: 'Read rows. Without ?sql, returns all rows including _row (needed for mutations). With ?sql=<GViz SELECT>, runs a server-side query — results do not include _row.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      query: z.object({
        sql: z.string().optional().openapi({
          example: "SELECT name, email WHERE role = 'admin'",
          description: 'GViz SQL query. Supports SELECT, WHERE, ORDER BY, LIMIT, OFFSET. Omit for all rows.',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Rows. Without sql: array with _row. With sql: { rows: [...] } without _row.',
        content: { 'application/json': { schema: z.union([z.array(RowSchema), z.object({ rows: z.array(z.record(z.unknown())) })]) } },
      },
      400: { description: 'Invalid SQL' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { sql } = c.req.valid('query');
    const spreadsheetId = c.get('spreadsheet_id');

    if (sql !== undefined) {
      const err = validateSql(sql);
      if (err) return c.json({ error: err }, 400);
      try {
        const rows = await GoogleClient.query(c.env, spreadsheetId, table_name, sql);
        return c.json({ rows });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
      }
    }

    try {
      const rows = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      return c.json(rows);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to read rows' }, 500);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{table_name}',
    tags: ['Data'],
    summary: 'Append a row. Values are mapped to column headers by key name (order-independent).',
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
      201: { description: 'Row appended', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
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

// ── Field-based row operations (/by/{field}/{value}) ──────────────────────
// Registered before /{row} so Hono matches the static "by" segment first.

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
    summary: 'Find all rows where a field equals a value. Returns rows including _row for follow-up mutations.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: { description: 'Matching rows (may be empty)', content: { 'application/json': { schema: z.object({ rows: z.array(RowSchema) }) } } },
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
    summary: 'Partially update all rows where a field equals a value. Only supplied fields change; others are preserved.',
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
      200: { description: 'Rows updated', content: { 'application/json': { schema: z.object({ updated: z.number() }) } } },
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
    summary: 'Delete all rows where a field equals a value. Rows are deleted highest-index-first to avoid row-shift corrupting later deletes.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: { description: 'Rows deleted', content: { 'application/json': { schema: z.object({ deleted: z.number() }) } } },
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

// ── Row operations by number ───────────────────────────────────────────────

dataRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{table_name}/{row}',
    tags: ['Data'],
    summary: 'Partially update a row by _row number. Only supplied fields change; others are preserved.',
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
      200: { description: 'Row updated', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
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

dataRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/{table_name}/{row}',
    tags: ['Data'],
    summary: 'Delete a row by _row number. Subsequent rows shift up — row numbers change after this.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: rowParams },
    responses: {
      200: { description: 'Row deleted', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
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
