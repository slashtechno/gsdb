/// <reference types="@types/bun" />
import { S3Client } from 'bun';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { appAuthMiddleware } from '../middleware/auth';
import type { Env } from '../types';

export const filesRouter = new OpenAPIHono<Env>();

const ErrorSchema = z.object({ error: z.string() });
const errJson = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } } as const,
});

// 401/403 are middleware-injected (handler never returns them); description-only avoids
// handler return-type mismatch while still documenting the shape for API consumers.
const FILE_ERRORS = {
  401: { description: 'Unauthorized — missing or invalid API key. Body: { error: string }' },
  403: { description: 'Forbidden — key belongs to a different app. Body: { error: string }' },
  501: errJson('File storage not configured — set S3_BUCKET and S3_ACCESS_KEY_ID'),
} as const;

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
    ...FILE_ERRORS,
  },
});

filesRouter.openapi(uploadRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;

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
    404: errJson('File not found'),
    ...FILE_ERRORS,
  },
});

filesRouter.openapi(downloadRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;

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
    ...FILE_ERRORS,
  },
});

filesRouter.openapi(deleteRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;

  const { key } = c.req.valid('param');
  const appId = c.get('app_id');

  await getS3(c.env).delete(`${appId}/${key}`);
  return c.json({ success: true });
});

// ── GET /files ─────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/files',
  tags: ['Files'],
  summary: 'List files owned by this app (up to 1000 per page)',
  middleware: [appAuthMiddleware] as const,
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({ app_id: z.string() }),
    query: z.object({
      prefix: z.string().optional().openapi({ description: 'Filter by key prefix', example: 'avatars/' }),
      start_after: z.string().optional().openapi({ description: 'Pagination cursor — last key from previous page' }),
      max_keys: z.coerce.number().int().min(1).max(1000).default(1000).optional(),
    }),
  },
  responses: {
    200: {
      description: 'File list',
      content: {
        'application/json': {
          schema: z.object({
            files: z.array(z.object({
              key: z.string(),
              size: z.number().optional(),
              last_modified: z.string().optional(),
              etag: z.string().optional(),
            })),
            truncated: z.boolean(),
            next_start_after: z.string().optional(),
          }),
        },
      },
    },
    401: { description: 'Unauthorized — missing or invalid API key. Body: { error: string }' },
    501: errJson('File storage not configured — set S3_BUCKET and S3_ACCESS_KEY_ID'),
  },
});

filesRouter.openapi(listRoute, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;

  const appId = c.get('app_id');
  const { prefix, start_after, max_keys } = c.req.valid('query');
  const appPrefix = `${appId}/`;
  const s3Prefix = prefix ? `${appPrefix}${prefix}` : appPrefix;

  const result = await getS3(c.env).list({
    prefix: s3Prefix,
    maxKeys: max_keys ?? 1000,
    startAfter: start_after ? `${appPrefix}${start_after}` : undefined,
  });

  const files = (result.contents ?? []).map((obj) => ({
    key: obj.key.slice(appPrefix.length),
    size: obj.size,
    last_modified: obj.lastModified,
    etag: obj.eTag,
  }));

  const last = files.at(-1);
  return c.json({
    files,
    truncated: result.isTruncated ?? false,
    next_start_after: result.isTruncated && last ? last.key : undefined,
  });
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
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;
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
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;
  const key = extractKey(c.req.path.replace(/\/presign$/, ''));
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  const s3Key = `${appId}/${key}`;
  const s3 = getS3(c.env);
  const url = s3.presign(s3Key, { method: 'PUT', expiresIn: 900 });
  return c.json({ url, key: s3Key, expires_in: 900 });
});

filesRouter.get('/files/*', appAuthMiddleware, async (c) => {
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;
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
  if (!assertS3(c.env)) return c.json({ error: 'File storage not configured' }, 501) as never;
  const key = extractKey(c.req.path);
  if (!key || !validateKey(key)) return c.json({ error: 'Invalid key' }, 400);
  const appId = c.get('app_id');
  await getS3(c.env).delete(`${appId}/${key}`);
  return c.json({ success: true });
});
