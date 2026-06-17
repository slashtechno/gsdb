import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { Dashboard } from '../ui/pages/Dashboard';
import type { Env } from '../types';

export const uiRouter = new Hono<Env>();

uiRouter.use('*', jsxRenderer());

uiRouter.get('/', (c) => {
  // Return minimal shell — data is loaded client-side after auth
  const baseUrl = new URL(c.req.url).origin;
  return c.html(<Dashboard baseUrl={baseUrl} />);
});
