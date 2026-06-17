/// <reference types="@types/bun" />
// Local dev server using Bun's built-in HTTP engine (no external adapter needed).
// Run with: bun run dev   OR   bun platform/node.ts
import app from '../src/index';
import type { Env } from '../src/types';

const PORT = Number(process.env.PORT ?? 3000);

function getBindings(): Env['Bindings'] {
  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ?? '',
    MASTER_SHEET_ID: process.env.MASTER_SHEET_ID ?? '',
    ADMIN_SECRET: process.env.ADMIN_SECRET ?? 'dev-secret',
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };
}

Bun.serve({
  port: PORT,
  fetch: (req: Request) => app.fetch(req, getBindings()),
});

console.log(`gsdb  →  http://localhost:${PORT}`);
console.log(`  UI:      http://localhost:${PORT}/ui`);
console.log(`  Docs:    http://localhost:${PORT}/docs`);
console.log(`  Schema:  http://localhost:${PORT}/openapi.json`);
