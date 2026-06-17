import { z } from 'zod';

// Runtime bindings injected by each platform adapter (see platform/*.ts).
// All values come from environment variables — no external KV or DB needed.
export type Env = {
  Bindings: {
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    // Long-lived refresh token. Obtained once via /auth/login, then stored as an env var.
    GOOGLE_REFRESH_TOKEN: string;
    // ID of the Google Sheet that stores the app registry (app_id, spreadsheet_id, api_key_hash).
    MASTER_SHEET_ID: string;
    ADMIN_SECRET: string;
    // Optional: move all created sheets into this Drive folder (folder ID from the URL)
    GDRIVE_FOLDER_ID?: string;
    // Optional S3-compatible file storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO, etc.)
    S3_BUCKET?: string;
    S3_REGION?: string;
    S3_ENDPOINT?: string;    // omit for AWS; set for R2/B2/MinIO
    S3_ACCESS_KEY_ID?: string;
    S3_SECRET_ACCESS_KEY?: string;
  };
  Variables: {
    spreadsheet_id: string;
    app_id: string;
  };
};

// Row shape in the Master Sheet and in-memory cache
export interface AppRecord {
  app_id: string;
  spreadsheet_id: string;
  api_key_hash: string;
  created_at: string;
}

export const ErrorSchema = z.object({ error: z.string() });
export const SuccessSchema = z.object({ success: z.boolean(), message: z.string().optional() });
