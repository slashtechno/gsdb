import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { Dashboard } from '../ui/pages/Dashboard';
import { GoogleClient } from '../utils/google';
import type { Env } from '../types';

export const uiRouter = new Hono<Env>();

uiRouter.use('*', jsxRenderer());

uiRouter.get('/', async (c) => {
  // Fetch app list from Master Sheet; surface errors gracefully in the UI
  let apps: { app_id: string; spreadsheet_id: string; created_at: string }[] = [];
  let loadError: string | null = null;

  try {
    const records = await GoogleClient.getMasterSheetApps(c.env);
    apps = records.map(({ app_id, spreadsheet_id, created_at }) => ({
      app_id, spreadsheet_id, created_at,
    }));
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Failed to load app registry';
  }

  return c.html(
    <Dashboard
      apps={apps}
      authenticated={!!c.env.GOOGLE_REFRESH_TOKEN}
      baseUrl={new URL(c.req.url).origin}
      loadError={loadError}
    />
  );
});
