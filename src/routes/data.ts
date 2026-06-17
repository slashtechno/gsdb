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

// Row object returned by GET (always includes _row)
const RowSchema = z.record(z.unknown()).and(z.object({ _row: z.number() }));

// Table schemas (Google Sheets calls these "tabs", but "tables" is more intuitive for DB users)
const tableParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table: z.string().openapi({ example: 'users' }),
});

const TableListSchema = z.object({ tables: z.array(z.string()) });
const TableCreateSchema = z.object({ table: z.string().min(1).openapi({ example: 'new_table' }) });

// Schema operation body — discriminated union keeps OpenAPI clean
const SchemaOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), name: z.string().min(1) }),
  z.object({ op: z.literal('rename'), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ op: z.literal('remove'), name: z.string().min(1) }),
]);

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
        content: { 'application/json': { schema: z.object({ columns: z.array(z.string()) }) } },
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
dataRouter.openapi(
  createRoute({
    method: 'put',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'Set (replace) the column headers for a sheet tab. Protects the header row from UI edits.',
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
        description: 'Headers written',
        content: { 'application/json': { schema: z.object({ columns: z.array(z.string()) }) } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const { columns } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    await GoogleClient.setHeaders(c.env, spreadsheetId, table_name, columns);
    return c.json({ columns });
  }
);

// ── PATCH /{table_name}/schema ─────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{table_name}/schema',
    tags: ['Schema'],
    summary: 'Add, rename, or remove a single column. op: "add" | "rename" | "remove".',
    middleware: [appAuthMiddleware] as const,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: tableNameParams,
      body: {
        content: { 'application/json': { schema: SchemaOpSchema } },
      },
    },
    responses: {
      200: {
        description: 'Updated column list',
        content: { 'application/json': { schema: z.object({ columns: z.array(z.string()) }) } },
      },
      400: { description: 'Bad request (column not found, name conflict, etc.)' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const { table_name } = c.req.valid('param');
    const op = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    try {
      if (op.op === 'add') {
        await GoogleClient.addColumn(c.env, spreadsheetId, table_name, op.name);
      } else if (op.op === 'rename') {
        await GoogleClient.renameColumn(c.env, spreadsheetId, table_name, op.from, op.to);
      } else {
        await GoogleClient.deleteColumn(c.env, spreadsheetId, table_name, op.name);
      }
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
    const { app_id } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    const tables = await GoogleClient.listTabs(c.env, spreadsheetId);
    return c.json({ tables });
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
    const { app_id } = c.req.valid('param');
    const { table } = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');

    const existingTables = await GoogleClient.listTabs(c.env, spreadsheetId);
    if (existingTables.includes(table)) {
      return c.json({ error: 'Table already exists' }, 400);
    }

    await GoogleClient.createTab(c.env, spreadsheetId, table);
    return c.json({ table, message: 'Table created successfully' }, 201);
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
    const { app_id, table } = c.req.valid('param');
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
        description: 'Query results',
        content: { 'application/json': { schema: z.object({ rows: z.array(RowSchema) }) } },
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
    const { table_name } = c.req.valid('param');
    const spreadsheetId = c.get('spreadsheet_id');
    const rows = await GoogleClient.getRows(c.env, spreadsheetId, table_name);
    return c.json(rows);
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
    const { table_name } = c.req.valid('param');
    const body = c.req.valid('json');
    const spreadsheetId = c.get('spreadsheet_id');
    await GoogleClient.appendRow(c.env, spreadsheetId, table_name, body);
    return c.json({ success: true }, 201);
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
