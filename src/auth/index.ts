import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const authRouter = new OpenAPIHono<Env>();

// drive.file: access only to files created or explicitly opened by this app.
// This prevents the token from reading arbitrary sheets on the authorized account.
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// Starts the OAuth flow by redirecting to Google's consent screen.
authRouter.get('/login', (c) => {
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',  // required to receive a refresh_token
    prompt: 'consent',        // forces refresh_token even if already authorized
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Exchanges the OAuth code for tokens, then creates (or reuses) the Master Sheet.
// Displays both values to copy into your Vercel environment variables.
authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');
  if (error || !code) {
    return c.json({ error: error ?? 'Missing authorization code' }, 400);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const data = (await tokenRes.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
  };

  if (data.error || !data.refresh_token || !data.access_token) {
    return c.json({
      error: data.error ?? 'No refresh_token returned — try /auth/login again',
    }, 400);
  }

  // Reuse existing Master Sheet if already set; otherwise create a new one.
  // drive.file scope gives us persistent access to files this app creates.
  let masterSheetId = c.env.MASTER_SHEET_ID;
  let createdSheet = false;
  if (!masterSheetId) {
    masterSheetId = await GoogleClient.createSpreadsheet(data.access_token, 'gsdb Registry', 'Apps');
    createdSheet = true;
  }

  const refreshToken = data.refresh_token;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>gsdb — Setup complete</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; padding: 48px 32px; max-width: 680px; margin: 0 auto; }
    h1 { color: #6c63ff; margin-bottom: 8px; }
    p { color: #94a3b8; margin-bottom: 24px; }
    .var { margin-bottom: 20px; }
    .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .token { background: #1a1d27; border: 1px solid #2a2d3d; border-radius: 8px; padding: 14px 16px; font-family: monospace; font-size: 13px; word-break: break-all; color: #22c55e; }
    button { margin-top: 10px; background: #6c63ff; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    .step { background: #1a1d27; border-left: 3px solid #6c63ff; padding: 12px 16px; margin-top: 28px; border-radius: 4px; font-size: 14px; color: #94a3b8; line-height: 1.6; }
    code { color: #6c63ff; background: rgba(108,99,255,0.1); padding: 2px 6px; border-radius: 4px; }
    .badge { display: inline-block; background: #22c55e22; color: #22c55e; font-size: 11px; padding: 2px 8px; border-radius: 99px; margin-left: 8px; vertical-align: middle; }
  </style>
</head>
<body>
  <h1>✓ Google authorization successful</h1>
  <p>Add both values below to your Vercel project's Environment Variables, then redeploy.</p>

  <div class="var">
    <div class="label">GOOGLE_REFRESH_TOKEN</div>
    <div class="token" id="rt">${refreshToken}</div>
    <button onclick="navigator.clipboard.writeText(document.getElementById('rt').textContent).then(() => this.textContent = '✓ Copied!')">Copy</button>
  </div>

  <div class="var">
    <div class="label">MASTER_SHEET_ID ${createdSheet ? '<span class="badge">just created</span>' : '<span class="badge">existing</span>'}</div>
    <div class="token" id="ms">${masterSheetId}</div>
    <button onclick="navigator.clipboard.writeText(document.getElementById('ms').textContent).then(() => this.textContent = '✓ Copied!')">Copy</button>
  </div>

  <div class="step">
    <strong>Next:</strong> In Vercel → Project → Settings → Environment Variables, set:<br>
    <code>GOOGLE_REFRESH_TOKEN</code> → the token above<br>
    <code>MASTER_SHEET_ID</code> → the sheet ID above<br><br>
    Then redeploy. These values are long-lived — you won't need to repeat this unless you revoke access.
  </div>
</body>
</html>`);
});

// Status endpoint used by the dashboard to show whether credentials are configured.
authRouter.openapi(
  createRoute({
    method: 'get',
    path: '/status',
    tags: ['Auth'],
    summary: 'Check whether GOOGLE_REFRESH_TOKEN is configured',
    responses: {
      200: {
        description: 'Auth status',
        content: { 'application/json': { schema: z.object({ authenticated: z.boolean() }) } },
      },
    },
  }),
  (c) => c.json({ authenticated: !!c.env.GOOGLE_REFRESH_TOKEN })
);
