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

// Register security schemes in OpenAPI components
app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key',
  description: 'API key from app registration (POST /manage/apps). Use as Bearer token in Authorization header.',
});
app.openAPIRegistry.registerComponent('securitySchemes', 'AdminSecretAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Admin-Secret',
  description: 'Admin secret from ADMIN_SECRET env var. Used for /manage/* endpoints.',
});

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
  security: [{ ApiKeyAuth: [] }],
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

// Route groups
app.route('/auth', authRouter);
app.route('/ui', uiRouter);
app.route('/manage', manageRouter);
// filesRouter must be mounted before dataRouter so that the static /files path
// takes priority over dataRouter's dynamic /:table_name catch-all.
app.route('/api/:app_id', filesRouter);
app.route('/api/:app_id', dataRouter);

// Root redirect
app.get('/', (c) => c.redirect('/ui'));

export default app;
