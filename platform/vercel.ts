// Vercel Serverless Function entry point.
// Reads all env vars from process.env and injects them into c.env for every request.
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

export default function handler(req: Request): Response | Promise<Response> {
  return app.fetch(req, getBindings());
}
