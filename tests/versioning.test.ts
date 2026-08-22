import { describe, test, expect, beforeEach } from 'bun:test';
import { mockGoogleClient, resetGoogleMocks } from './helpers/google-mock';
import { setUpAuthedApp, authHeaders, TEST_ENV, TEST_APP_ID } from './helpers/fixtures';
import { jsonBody } from './helpers/json';
import app from '../src/index';

beforeEach(async () => {
  resetGoogleMocks();
  await setUpAuthedApp();
});

describe('frozen /api/v1 surface', () => {
  test('/api/v1/{app_id}/tables is reachable', async () => {
    mockGoogleClient.listTabs.mockResolvedValue(['users']);

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ tables: ['users'] });
  });

  test('the pre-v1 unversioned path no longer exists', async () => {
    const res = await app.request(`/api/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(404);
  });

  test('the OpenAPI schema only advertises /api/v1/* — no ambiguous unversioned duplicate', async () => {
    const res = await app.request('/openapi.json', {}, TEST_ENV);
    const spec = await jsonBody(res);

    const apiPaths = Object.keys(spec.paths).filter((p) => p.startsWith('/api/'));
    expect(apiPaths.length).toBeGreaterThan(0);
    for (const path of apiPaths) {
      expect(path.startsWith('/api/v1/')).toBe(true);
    }
  });
});
