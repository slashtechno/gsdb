import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import { GoogleClient, RateLimitError } from '../utils/google';
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

// Row always includes _row so callers can reference it for mutations.
const RowSchema = z.record(z.unknown()).and(z.object({ _row: z.number() }));
const ColumnsSchema = z.object({ columns: z.array(z.string()) });
const TableListSchema = z.object({ tables: z.array(z.string()) });

// Structured error bodies — exposed in OpenAPI so callers can type-check error handling.
const ErrorSchema = z.object({ error: z.string() });
const RateLimitSchema = z.object({
  error: z.string(),
  retryAfter: z.number().nullable().openapi({ description: 'Seconds to wait before retrying, if provided by Google.' }),
});

// ── Route helpers ──────────────────────────────────────────────────────────

// Wraps a schema in the OpenAPI JSON content envelope.
const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } } as const,
});

// Auth errors are injected by middleware before the handler runs, so the handler
// never returns these directly. Use description-only to avoid handler type mismatch.
const AUTH_ERRORS = {
  401: { description: 'Unauthorized — missing or invalid API key. Body: { error: string }' },
  403: { description: 'Forbidden — key does not belong to this app. Body: { error: string }' },
} as const;

// Catches thrown errors. RateLimitError → 429 with retryAfter. All others → 400.
const tryOrError = async <T>(
  c: { json: (body: unknown, status?: number) => Response },
  fn: () => Promise<T>
): Promise<T | Response> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RateLimitError) {
      return c.json({ error: err.message, retryAfter: err.retryAfter }, 429) as Response;
    }
    return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400) as Response;
  }
};

// Standard error responses shared across all routes.
const COMMON_ERRORS = {
  429: jsonContent(RateLimitSchema, 'Google Sheets API rate limit exceeded. Back off and retry, using retryAfter seconds if present.'),
  ...AUTH_ERRORS,
} as const;

// ── Schema endpoints ───────────────────────────────────────────────────────
// Registered before /{row} so Hono matches the static "schema" segment first.

dataRouter.openapi(
  createRoute({
    method: 'get', path: '/{table_name}/schema',
    tags: ['Schema'], summary: 'List column headers in order.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableNameParams },
    responses: { 200: jsonContent(ColumnsSchema, 'Column names'), ...COMMON_ERRORS },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const columns = await GoogleClient.getHeaders(c.env, c.get('spreadsheet_id'), table_name);
    return c.json({ columns });
  }
);

// True full-replace: columns absent from the request are deleted along with their data.
dataRouter.openapi(
  createRoute({
    method: 'put', path: '/{table_name}/schema',
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
    responses: { 200: jsonContent(ColumnsSchema, 'Schema replaced'), ...COMMON_ERRORS },
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

// POST /{table}/schema/{column} — add a column; name comes from the URL, no body needed.
dataRouter.openapi(
  createRoute({
    method: 'post', path: '/{table_name}/schema/{column}',
    tags: ['Schema'],
    summary: 'Add a column. Appended after the last existing column; existing rows get empty values.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: columnParams },
    responses: {
      200: jsonContent(ColumnsSchema, 'Column added'),
      400: jsonContent(ErrorSchema, 'Column already exists'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    const result = await tryOrError(c, () => GoogleClient.addColumn(c.env, spreadsheetId, table_name, column));
    if (result instanceof Response) return result;
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// PUT /{table}/schema/{column} — rename: replaces the named resource with new state.
dataRouter.openapi(
  createRoute({
    method: 'put', path: '/{table_name}/schema/{column}',
    tags: ['Schema'],
    summary: 'Rename a column. Only the header label changes — all cell data in that column is preserved.',
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
      200: jsonContent(ColumnsSchema, 'Column renamed'),
      400: jsonContent(ErrorSchema, 'Column not found or name conflict'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    const result = await tryOrError(c, () => GoogleClient.renameColumn(c.env, spreadsheetId, table_name, column, name));
    if (result instanceof Response) return result;
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete', path: '/{table_name}/schema/{column}',
    tags: ['Schema'],
    summary: 'Delete a column and all its cell data. Uses deleteDimension — the header and data are removed as one unit, so remaining columns shift left with their data intact (no header-to-data misalignment).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: columnParams },
    responses: {
      200: jsonContent(ColumnsSchema, 'Column deleted'),
      400: jsonContent(ErrorSchema, 'Column not found'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, column } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    const result = await tryOrError(c, () => GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, column));
    if (result instanceof Response) return result;
    const columns = await GoogleClient.getHeaders(c.env, spreadsheetId, table_name);
    return c.json({ columns });
  }
);

// ── Table CRUD ─────────────────────────────────────────────────────────────

dataRouter.openapi(
  createRoute({
    method: 'get', path: '/tables',
    tags: ['Tables'], summary: 'List all tables (tabs).',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: z.object({ app_id: z.string() }) },
    responses: { 200: jsonContent(TableListSchema, 'Table names'), ...COMMON_ERRORS },
  }),
  async (c) => {
    try {
      const tables = await GoogleClient.listTabs(c.env, c.get('spreadsheet_id'));
      return c.json({ tables });
    } catch (err) {
      console.error('listTabs error:', err instanceof Error ? err.message : 'Failed to list tables', { cause: err });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to list tables' }, 500);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'post', path: '/tables',
    tags: ['Tables'], summary: 'Create a table with no headers. Use PUT /{table}/schema to set columns.',
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
      201: jsonContent(z.object({ table: z.string() }), 'Table created'),
      400: jsonContent(ErrorSchema, 'Table already exists'),
      ...COMMON_ERRORS,
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
      console.error('createTab error:', err instanceof Error ? err.message : 'Failed to create table', { cause: err });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create table' }, 500);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete', path: '/tables/{table}',
    tags: ['Tables'], summary: 'Delete a table and all its data. Cannot delete the last remaining table.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: tableParams },
    responses: {
      200: jsonContent(z.object({ success: z.boolean() }), 'Table deleted'),
      400: jsonContent(ErrorSchema, 'Cannot delete the last table'),
      404: { description: 'Table not found' },
      ...COMMON_ERRORS,
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
      console.error('deleteTab error:', err instanceof Error ? err.message : 'Failed to delete table', { cause: err });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to delete table' }, 500);
    }
  }
);

// ── Data endpoints ─────────────────────────────────────────────────────────

// GViz SQL validation — GViz is read-only by design, but block obvious misuse.
function validateSql(sql: string): string | null {
  const lower = sql.toLowerCase().trim();
  const blocked = ['drop', 'delete', 'insert', 'update', 'create', 'alter', 'grant', 'revoke', 'exec', 'execute'];
  for (const word of blocked) {
    if (lower.includes(word)) return `${word.toUpperCase()} is not allowed in GViz SQL`;
  }
  if (lower !== '' && !lower.startsWith('select')) {
    return 'Only SELECT queries are allowed (or omit sql for all rows)';
  }
  return null;
}

// GET /{table} — all rows. Optional ?sql= runs a GViz query instead (no _row in results).
dataRouter.openapi(
  createRoute({
    method: 'get', path: '/{table_name}',
    tags: ['Data'],
    summary: 'Read rows. Without ?sql returns all rows including _row (needed for mutations). With ?sql=<GViz SELECT> runs a server-side query — results do not include _row.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      query: z.object({
        sql: z.string().optional().openapi({
          example: "SELECT name, email WHERE role = 'admin'",
          description: 'GViz SQL. Supports SELECT, WHERE, ORDER BY, LIMIT, OFFSET. Omit for all rows.',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Without sql: row array with _row. With sql: { rows: [...] } without _row.',
        content: {
          'application/json': {
            schema: z.union([z.array(RowSchema), z.object({ rows: z.array(z.record(z.unknown())) })]),
          },
        },
      },
      400: jsonContent(ErrorSchema, 'Invalid SQL'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { sql } = c.req.valid('query');
    const spreadsheetId = c.get('spreadsheet_id');

    if (sql !== undefined) {
      const err = validateSql(sql);
      if (err) return c.json({ error: err }, 400);
      return await tryOrError(c, async () => {
        const rows = await GoogleClient.query(c.env, spreadsheetId, table_name, sql);
        return c.json({ rows });
      }) as Response;
    }

    try {
      const rows = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      return c.json(rows);
    } catch (err) {
      console.error('getRows error:', { table: table_name, message: err instanceof Error ? err.message : 'Failed to read rows', cause: err });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to read rows' }, 500);
    }
  }
);

dataRouter.openapi(
  createRoute({
    method: 'post', path: '/{table_name}',
    tags: ['Data'], summary: 'Append a row. Values mapped to column headers by key name (order-independent).',
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
      201: jsonContent(z.object({ success: z.boolean() }), 'Row appended'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    try {
      const spreadsheetId = c.get('spreadsheet_id');
      await GoogleClient.appendRow(c.env, spreadsheetId, table_name, c.req.valid('json'));
      return c.json({ success: true }, 201);
    } catch (err) {
      console.error('appendRow error:', { table: table_name, message: err instanceof Error ? err.message : 'Failed to append row', cause: err });
      return c.json({ error: err instanceof Error ? err.message : 'Failed to append row' }, 500);
    }
  }
);

// ── Batch operations ───────────────────────────────────────────────────────

// POST /{table}/batch — insert many rows in one Sheets API call
dataRouter.openapi(
  createRoute({
    method: 'post', path: '/{table_name}/batch',
    tags: ['Data'], summary: 'Insert multiple rows in a single API call. All rows are mapped to existing column headers.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.array(z.record(z.unknown())).min(1).openapi({
              example: [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
              ],
            }),
          },
        },
      },
    },
    responses: {
      201: jsonContent(z.object({ inserted: z.number() }), 'Rows inserted'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const rows = c.req.valid('json');
    return await tryOrError(c, async () => {
      await GoogleClient.appendRows(c.env, c.get('spreadsheet_id'), table_name, rows);
      return c.json({ inserted: rows.length }, 201);
    }) as Response;
  }
);

// PATCH /{table}/batch — update many rows in one Sheets API call
// Each item must include _row (from a prior GET) plus the fields to change.
dataRouter.openapi(
  createRoute({
    method: 'patch', path: '/{table_name}/batch',
    tags: ['Data'],
    summary: 'Partially update multiple rows in a single API call. Each item must include _row (from a prior GET). Only supplied fields change; others are preserved.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.array(
              z.record(z.unknown()).and(z.object({ _row: z.number().int().positive() }))
            ).min(1).openapi({
              example: [
                { _row: 1, status: 'active' },
                { _row: 3, status: 'inactive', role: 'viewer' },
              ],
            }),
          },
        },
      },
    },
    responses: {
      200: jsonContent(z.object({ updated: z.number() }), 'Rows updated'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const patches = c.req.valid('json') as Array<{ _row: number } & Record<string, unknown>>;
    return await tryOrError(c, async () => {
      await GoogleClient.batchUpdateRows(c.env, c.get('spreadsheet_id'), table_name, patches);
      return c.json({ updated: patches.length });
    }) as Response;
  }
);

// DELETE /{table}/batch — delete many rows in one batchUpdate call
dataRouter.openapi(
  createRoute({
    method: 'delete', path: '/{table_name}/batch',
    tags: ['Data'],
    summary: 'Delete multiple rows in a single API call. Supply _row values from a prior GET. Rows are deleted highest-index-first to avoid index shift errors.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({
              rows: z.array(z.number().int().positive()).min(1).openapi({ example: [1, 3, 5] }),
            }),
          },
        },
      },
    },
    responses: {
      200: jsonContent(z.object({ deleted: z.number() }), 'Rows deleted'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { rows } = c.req.valid('json');
    return await tryOrError(c, async () => {
      await GoogleClient.deleteRows(c.env, c.get('spreadsheet_id'), table_name, rows);
      return c.json({ deleted: rows.length });
    }) as Response;
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
    method: 'get', path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'], summary: 'Find all rows where a field equals a value. Returns rows including _row for follow-up mutations.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: jsonContent(z.array(RowSchema), 'Matching rows (may be empty)'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    return await tryOrError(c, async () => {
      const all = await GoogleClient.getRows(c.env, c.get('spreadsheet_id'), table_name);
      return c.json(matchRows(all, field, value));
    }) as Response;
  }
);

dataRouter.openapi(
  createRoute({
    method: 'patch', path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'], summary: 'Partially update all rows where a field equals a value. Only supplied fields change; others are preserved.',
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
      200: jsonContent(z.object({ updated: z.number() }), 'Rows updated'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    const patch = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    return await tryOrError(c, async () => {
      const all = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      const matches = matchRows(all, field, value);
      for (const row of matches) {
        await GoogleClient.updateRow(c.env, spreadsheetId, table_name, row._row, patch);
      }
      return c.json({ updated: matches.length });
    }) as Response;
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete', path: '/{table_name}/by/{field}/{value}',
    tags: ['Data'], summary: 'Delete all rows where a field equals a value. Deleted highest-index-first to avoid row-shift corrupting later deletes.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: byFieldParams },
    responses: {
      200: jsonContent(z.object({ deleted: z.number() }), 'Rows deleted'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, field, value } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    return await tryOrError(c, async () => {
      const all = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
      const matches = matchRows(all, field, value);
      await GoogleClient.deleteRows(c.env, spreadsheetId, table_name, matches.map((r) => r._row));
      return c.json({ deleted: matches.length });
    }) as Response;
  }
);

// ── Row operations by number ───────────────────────────────────────────────

dataRouter.openapi(
  createRoute({
    method: 'patch', path: '/{table_name}/{row}',
    tags: ['Data'], summary: 'Partially update a row by _row number. Only supplied fields change; others are preserved.',
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
      200: jsonContent(z.object({ success: z.boolean() }), 'Row updated'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, row } = c.req.valid('param');
    return await tryOrError(c, async () => {
      await GoogleClient.updateRow(c.env, c.get('spreadsheet_id'), table_name, row, c.req.valid('json'));
      return c.json({ success: true });
    }) as Response;
  }
);

dataRouter.openapi(
  createRoute({
    method: 'delete', path: '/{table_name}/{row}',
    tags: ['Data'], summary: 'Delete a row by _row number. Subsequent rows shift up — _row values change after this.',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: { params: rowParams },
    responses: {
      200: jsonContent(z.object({ success: z.boolean() }), 'Row deleted'),
      400: jsonContent(ErrorSchema, 'Bad request'),
      ...COMMON_ERRORS,
    },
  }),
  async (c) => {
    const { table_name, row } = c.req.valid('param');
    return await tryOrError(c, async () => {
      await GoogleClient.deleteRow(c.env, c.get('spreadsheet_id'), table_name, row);
      return c.json({ success: true });
    }) as Response;
  }
);
