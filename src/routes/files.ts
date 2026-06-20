/// <reference types="@types/bun" />
import { S3Client } from 'bun';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import type { Env } from '../types';

export const filesRouter = new OpenAPIHono<Env>();

// Build an S3Client from c.env — provider-agnostic via S3_ENDPOINT.
// Works with AWS S3 (omit endpoint), Cloudflare R2, Backblaze B2, MinIO, etc.
function getS3(env: Env['Bindings']): S3Client {
  return new S3Client({
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    bucket: env.S3_BUCKET ?? '',
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT,
  });
}

// Returns 501 if the required S3 env vars are not set.
function assertS3(env: Env['Bindings']): string | null {
  return env.S3_BUCKET && env.S3_ACCESS_KEY_ID ? env.S3_BUCKET : null;
}

// ── PUT /files/{key} ───────────────────────────────────────────────────────
const uploadRoute = createRoute({
  method: 'put',
  path: '/files/{key}',
  tags: ['Files'],
  summary: 'Upload a file to S3-compatible storage',
  middleware: [appAuthMiddleware] as const,
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      app_id: z.string(),
      key: z.string().openapi({ example: 'avatars/user-42.png' }),
    }),
  },
  responses: {
    200: {
      description: 'Upload successful — returns a 1-hour pre-signed GET URL',
      content: {
        'application/json': {
          schema: z.object({ key: z.string(), url: z.string(), expires_in: z.number() }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    501: { description: 'File storage not configured' },
  },
});

filesRouter.openapi(uploadRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);

  const { key } = c.req.valid('param');
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';

  const s3 = getS3(c.env);
  const body = await c.req.arrayBuffer();

  await s3.write(s3Key, new Uint8Array(body), { type: contentType });

  // presign() is sync in Bun's S3 SDK — no async overhead
  const url = s3.presign(s3Key, { method: 'GET', expiresIn: 3600 });
  return c.json({ key: s3Key, url, expires_in: 3600 });
});

// ── GET /files/{key} ───────────────────────────────────────────────────────
const downloadRoute = createRoute({
  method: 'get',
  path: '/files/{key}',
  tags: ['Files'],
  summary: 'Get a pre-signed download URL (1 hour)',
  middleware: [appAuthMiddleware] as const,
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      app_id: z.string(),
      key: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Pre-signed URL',
      content: {
        'application/json': { schema: z.object({ url: z.string(), expires_in: z.number() }) },
      },
    },
    404: { description: 'Not found' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    501: { description: 'File storage not configured' },
  },
});

filesRouter.openapi(downloadRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);

  const { key } = c.req.valid('param');
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const s3 = getS3(c.env);

  // Check existence before presigning to return a proper 404
  const exists = await s3.file(s3Key).exists();
  if (!exists) return c.json({ error: 'File not found' }, 404);

  const url = s3.presign(s3Key, { method: 'GET', expiresIn: 3600 });
  return c.json({ url, expires_in: 3600 });
});

// ── DELETE /files/{key} ────────────────────────────────────────────────────
const deleteRoute = createRoute({
  method: 'delete',
  path: '/files/{key}',
  tags: ['Files'],
  summary: 'Delete a file from S3-compatible storage',
  middleware: [appAuthMiddleware] as const,
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      app_id: z.string(),
      key: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Deleted',
      content: {
        'application/json': { schema: z.object({ success: z.boolean() }) },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    501: { description: 'File storage not configured' },
  },
});

filesRouter.openapi(deleteRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);

  const { key } = c.req.valid('param');
  const appId = c.get('app_id');

  await getS3(c.env).delete(`${appId}/${key}`);
  return c.json({ success: true });
});

// ── Wildcard routes for keys that contain slashes ──────────────────────────
// Hono's named params don't capture '/', so /files/{key} won't match
// keys like "folder/subfolder/file.png". These plain routes catch those cases.
// The key is everything after /files/ in the path.
function extractKey(path: string): string {
  const match = path.match(/\/files\/(.+)$/);
  return match?.[1] ?? '';
}

// Reject keys with path traversal sequences or null bytes.
// S3 keys are scoped to `${appId}/` — a crafted key like `../../other/file`
// would escape that prefix and allow cross-tenant access.
function validateKey(key: string): boolean {
  const segments = key.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\0') && !s.includes('\\'));
}

filesRouter.put('/files/*', appAuthMiddleware, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);
  const key = extractKey(c.req.path);
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
  const s3 = getS3(c.env);
  await s3.write(s3Key, new Uint8Array(await c.req.arrayBuffer()), { type: contentType });
  const url = s3.presign(s3Key, { method: 'GET', expiresIn: 3600 });
  return c.json({ key: s3Key, url, expires_in: 3600 });
});

// ── GET /files/{key}/upload-url — pre-signed direct upload URL ────────────
// ── POST /files/{key}/presign — direct upload URL (bypasses Vercel) ────────
// Returns a short-lived S3 PUT pre-signed URL. The client uploads directly
// to S3 — no file bytes pass through Vercel, saving egress bandwidth.
// Registered as /files/* catch-all (like the other slash-key routes) because
// mid-path wildcards behave inconsistently across Hono router implementations.
filesRouter.post('/files/*', appAuthMiddleware, async (c) => {
  if (!c.req.path.endsWith('/presign')) return c.notFound();
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);
  const key = extractKey(c.req.path.replace(/\/presign$/, ''));
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const s3 = getS3(c.env);
  const url = s3.presign(s3Key, { method: 'PUT', expiresIn: 900 });
  return c.json({ url, key: s3Key, expires_in: 900 });
});

filesRouter.get('/files/*', appAuthMiddleware, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);
  const key = extractKey(c.req.path);
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const s3 = getS3(c.env);
  const exists = await s3.file(s3Key).exists();
  if (!exists) return c.json({ error: 'File not found' }, 404);
  const url = s3.presign(s3Key, { method: 'GET', expiresIn: 3600 });
  return c.json({ url, expires_in: 3600 });
});

filesRouter.delete('/files/*', appAuthMiddleware, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501);
  const key = extractKey(c.req.path);
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  await getS3(c.env).delete(`${appId}/${key}`);
  return c.json({ success: true });
});
