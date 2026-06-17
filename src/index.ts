import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { dataRouter } from './routes/data';
import { filesRouter } from './routes/files';
import { manageRouter } from './routes/manage';
import { authRouter } from './auth/index';
import { uiRouter } from './routes/ui';
import type { Env } from './types';

const app = new OpenAPIHono<Env>();

app.use('*', logger());
app.use('*', cors());

// OpenAPI spec & Swagger UI
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'gsdb — Google Sheets Database Proxy',
    version: '1.0.0',
    description:
      'A serverless proxy that exposes Google Sheets as REST API endpoints. ' +
      'Use this OpenAPI schema URL with any LLM or coding agent to enable full database access.',
  },
  servers: [{ url: '/', description: 'Current server' }],
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

// Route groups
app.route('/auth', authRouter);
app.route('/ui', uiRouter);
app.route('/manage', manageRouter);
app.route('/api/:app_id', dataRouter);
app.route('/api/:app_id', filesRouter);

// Root redirect
app.get('/', (c) => c.redirect('/ui'));

export default app;
