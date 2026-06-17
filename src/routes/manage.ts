import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { adminAuthMiddleware, invalidateAppsCache, invalidateAppTokens } from '../middleware/auth';
import { hashApiKey, generateApiKey } from '../utils/crypto';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const manageRouter = new OpenAPIHono<Env>();

// ── POST /manage/apps ──────────────────────────────────────────────────────
manageRouter.openapi(
  createRoute({
    method: 'post',
    path: '/apps',
    tags: ['Manage'],
    summary: 'Create a new app — gsdb creates a dedicated Google Sheet automatically',
    middleware: [adminAuthMiddleware] as const,
    security: [{ AdminSecretAuth: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              app_id: z.string().min(1).openapi({ example: 'my-app' }),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created — api_key is shown only once; spreadsheet_id is the new sheet',
        content: {
          'application/json': {
            schema: z.object({ app_id: z.string(), api_key: z.string(), spreadsheet_id: z.string() }),
          },
        },
      },
      403: { description: 'Forbidden' },
      409: { description: 'app_id already exists' },
    },
  }),
  async (c) => {
    const { app_id } = c.req.valid('json');

    const existing = await GoogleClient.getMasterSheetApps(c.env);
    if (existing.some((a) => a.app_id === app_id)) {
      return c.json({ error: 'app_id already exists' }, 409);
    }

    // Create a dedicated spreadsheet using the drive.file-scoped token.
    const accessToken = await GoogleClient.getAccessToken(c.env);
    const spreadsheet_id = await GoogleClient.createSpreadsheet(accessToken, app_id);

    // Optionally move the new sheet into a specific Drive folder.
    if (c.env.GDRIVE_FOLDER_ID) {
      await GoogleClient.moveToFolder(accessToken, spreadsheet_id, c.env.GDRIVE_FOLDER_ID);
    }

    const apiKey = generateApiKey();
    const api_key_hash = await hashApiKey(apiKey);

    await GoogleClient.appendMasterSheetApp(c.env, {
      app_id,
      spreadsheet_id,
      api_key_hash,
      created_at: new Date().toISOString(),
    });

    invalidateAppsCache();
    return c.json({ app_id, api_key: apiKey, spreadsheet_id }, 201);
  }
);

// ── GET /manage/apps ───────────────────────────────────────────────────────
manageRouter.openapi(
  createRoute({
    method: 'get',
    path: '/apps',
    tags: ['Manage'],
    summary: 'List all registered apps',
    middleware: [adminAuthMiddleware] as const,
    security: [{ AdminSecretAuth: [] }],
    responses: {
      200: {
        description: 'App list (api_key_hash omitted)',
        content: {
          'application/json': {
            schema: z.array(z.object({
              app_id: z.string(),
              spreadsheet_id: z.string(),
              created_at: z.string(),
            })),
          },
        },
      },
      403: { description: 'Forbidden' },
    },
  }),
  async (c) => {
    const apps = await GoogleClient.getMasterSheetApps(c.env);
    // Never expose the hash
    return c.json(apps.map(({ app_id, spreadsheet_id, created_at }) => ({
      app_id, spreadsheet_id, created_at,
    })));
  }
);

// ── DELETE /manage/apps/{app_id} ───────────────────────────────────────────
manageRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/apps/{app_id}',
    tags: ['Manage'],
    summary: 'Remove an app registration',
    middleware: [adminAuthMiddleware] as const,
    security: [{ AdminSecretAuth: [] }],
    request: { params: z.object({ app_id: z.string() }) },
    responses: {
      200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
      403: { description: 'Forbidden' },
      404: { description: 'Not found' },
    },
  }),
  async (c) => {
    const { app_id } = c.req.valid('param');
    const apps = await GoogleClient.getMasterSheetApps(c.env);
    if (!apps.some((a) => a.app_id === app_id)) {
      return c.json({ error: 'App not found' }, 404);
    }

    await GoogleClient.rewriteMasterSheetApps(c.env, apps.filter((a) => a.app_id !== app_id));
    invalidateAppsCache();
    invalidateAppTokens(app_id);
    return c.json({ success: true });
  }
);

// ── POST /manage/apps/{app_id}/rotate ─────────────────────────────────────
manageRouter.openapi(
  createRoute({
    method: 'post',
    path: '/apps/{app_id}/rotate',
    tags: ['Manage'],
    summary: 'Issue a new API key for an app (old key is immediately invalidated)',
    middleware: [adminAuthMiddleware] as const,
    security: [{ AdminSecretAuth: [] }],
    request: { params: z.object({ app_id: z.string() }) },
    responses: {
      200: {
        description: 'New key — shown only once',
        content: { 'application/json': { schema: z.object({ app_id: z.string(), api_key: z.string() }) } },
      },
      403: { description: 'Forbidden' },
      404: { description: 'Not found' },
    },
  }),
  async (c) => {
    const { app_id } = c.req.valid('param');
    const apps = await GoogleClient.getMasterSheetApps(c.env);
    const idx = apps.findIndex((a) => a.app_id === app_id);
    if (idx === -1) return c.json({ error: 'App not found' }, 404);

    const apiKey = generateApiKey();
    apps[idx] = { ...apps[idx], api_key_hash: await hashApiKey(apiKey) };

    await GoogleClient.rewriteMasterSheetApps(c.env, apps);
    invalidateAppsCache();
    invalidateAppTokens(app_id);
    return c.json({ app_id, api_key: apiKey });
  }
);
