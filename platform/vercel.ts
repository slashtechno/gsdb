// Vercel Serverless Function entry point.
// This adapter accepts both "Edge" style (Request) invocations and
// Node-style (req, res) serverless invocations. When Vercel calls the
// module with (req, res) the incoming `req` is a Node IncomingMessage
// where headers are a plain object and not a Fetch `Headers` instance.
// Convert Node-style calls into a proper Fetch `Request`, dispatch into
// the Hono app, then pipe the Response back to the Node `res`.

import app from '../src/index';
import type { Env } from '../src/types';

function getBindings(): Env['Bindings'] {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ?? '',
    MASTER_SHEET_ID: process.env.MASTER_SHEET_ID ?? '',
    ADMIN_SECRET: process.env.ADMIN_SECRET ?? '',
    GDRIVE_FOLDER_ID: process.env.GDRIVE_FOLDER_ID,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };
}

export default async function handler(req: Request | any, res?: any): Promise<Response | void> {
  // Node-style invocation (req, res) — build a Fetch Request and proxy result
  if (res && typeof res.setHeader === 'function') {
    // Reconstruct an absolute URL — prefer forwarded proto/host when available
    const forwardedProto = req.headers?.['x-forwarded-proto'] || req.headers?.['x-forwarded-protocol'];
    const host = req.headers?.host || req.headers?.['x-forwarded-host'] || 'localhost';
    const protocol = forwardedProto || 'https';
    const url = `${protocol}://${host}${req.url}`;

    const init: RequestInit = {
      method: req.method,
      headers: req.headers as Record<string,string>,
      // For non-GET/HEAD methods pass the Node request stream as the body.
      body: req.method && req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    };

    const request = new Request(url, init);
    const response = await app.fetch(request, getBindings());

    // Forward status and headers
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      try { res.setHeader(key, value); } catch (e) { /* ignore header errors */ }
    });

    // Stream response body to Node res
    const buffer = await response.arrayBuffer();
    // Buffer is available in Node; cast to any to avoid TS Node types here
    res.end(Buffer.from(buffer));
    return;
  }

  // Edge/Fetch-style invocation — pass through directly
  return app.fetch(req as Request, getBindings());
}
