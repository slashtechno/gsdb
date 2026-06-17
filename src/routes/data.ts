import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const dataRouter = new OpenAPIHono<Env>();

// ── GET /{table_name} ──────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get',
  path: '/{table_name}',
  tags: ['Data'],
  summary: 'Query rows from a sheet tab',
  middleware: [appAuthMiddleware] as const,
  request: {
    params: z.object({
      app_id: z.string().openapi({ example: 'my-app' }),
      table_name: z.string().openapi({ example: 'users' }),
    }),
    query: z.object({
      q: z.string().optional().openapi({
        description: 'GViz SQL SELECT string (e.g. "SELECT * WHERE A=\'foo\'")',
        example: 'SELECT *',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Rows from the sheet',
      content: { 'application/json': { schema: z.array(z.record(z.unknown())) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

dataRouter.openapi(getRoute, async (c) => {
  const { table_name } = c.req.valid('param');
  const { q } = c.req.valid('query');
  const spreadsheetId = c.get('spreadsheet_id');

  const sql = q || 'SELECT *';
  const data = await GoogleClient.query(c.env, spreadsheetId, table_name, sql);
  return c.json(data);
});

// ── POST /{table_name} ─────────────────────────────────────────────────────
const postRoute = createRoute({
  method: 'post',
  path: '/{table_name}',
  tags: ['Data'],
  summary: 'Append a row to a sheet tab',
  middleware: [appAuthMiddleware] as const,
  request: {
    params: z.object({
      app_id: z.string(),
      table_name: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.record(z.unknown()).openapi({ description: 'Row object to append' }),
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
});

dataRouter.openapi(postRoute, async (c) => {
  const { table_name } = c.req.valid('param');
  const body = c.req.valid('json');
  const spreadsheetId = c.get('spreadsheet_id');

  // Append as a single row; values are ordered by object key insertion order
  const values = [Object.values(body)];
  await GoogleClient.append(c.env, spreadsheetId, `${table_name}`, values);
  return c.json({ success: true }, 201);
});

// ── GET /{table_name}/schema ───────────────────────────────────────────────
const schemaRoute = createRoute({
  method: 'get',
  path: '/{table_name}/schema',
  tags: ['Data'],
  summary: 'Return column headers for a sheet tab',
  middleware: [appAuthMiddleware] as const,
  request: {
    params: z.object({
      app_id: z.string(),
      table_name: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Column schema',
      content: {
        'application/json': {
          schema: z.object({ columns: z.array(z.string()) }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

dataRouter.openapi(schemaRoute, async (c) => {
  const { table_name } = c.req.valid('param');
  const spreadsheetId = c.get('spreadsheet_id');

  // Fetch only first row to derive column names
  const data = await GoogleClient.query(
    c.env,
    spreadsheetId,
    table_name,
    'SELECT * LIMIT 1'
  );
  const columns = data.length > 0 ? Object.keys(data[0]) : [];
  return c.json({ columns });
});
