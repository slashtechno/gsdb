import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { Dashboard } from '../ui/pages/Dashboard';
import { AppDetail } from '../ui/pages/AppDetail';
import { TableView } from '../ui/pages/TableView';
import type { Env } from '../types';

export const uiRouter = new Hono<Env>();

uiRouter.use('*', jsxRenderer());

uiRouter.get('/', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(<Dashboard baseUrl={baseUrl} />);
});

uiRouter.get('/apps/:app_id', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(<AppDetail app_id={c.req.param('app_id')} baseUrl={baseUrl} />);
});

uiRouter.get('/apps/:app_id/:table', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(
    <TableView
      app_id={c.req.param('app_id')}
      table={c.req.param('table')}
    />
  );
});
