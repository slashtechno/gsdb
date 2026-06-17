import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const dataRouter = new OpenAPIHono<Env>();

// Shared param schemas
const tableParams = z.object({
  app_id: z.string().openapi({ example: 'my-app' }),
  table_name: z.string().openapi({ example: 'users' }),
});

const rowParams = tableParams.extend({
  row: z.coerce.number().int().positive().openapi({ description: '_row index from a GET response', example: 1 }),
});

// Row object returned by GET (always includes _row)
const RowSchema = z.record(z.unknown()).and(z.object({ _row: z.number() }));

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
    request: { params: tableParams },
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
    request: {
      params: tableParams,
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
    request: {
      params: tableParams,
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

// ── GET /{table_name} ──────────────────────────────────────────────────────
dataRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{table_name}',
    tags: ['Data'],
    summary: 'Read all rows from a sheet tab. Each row includes _row (use this for PATCH/DELETE).',
    middleware: [appAuthMiddleware] as const,
    request: { params: tableParams },
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
    request: {
      params: tableParams,
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
