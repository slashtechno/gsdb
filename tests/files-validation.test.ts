import { describe, test, expect, beforeEach } from 'bun:test';
import { resetGoogleMocks } from './helpers/google-mock';
import { setUpAuthedApp, authHeaders, TEST_ENV, TEST_APP_ID } from './helpers/fixtures';
import { jsonBody } from './helpers/json';
import app from '../src/index';

const S3_ENV = { ...TEST_ENV, S3_BUCKET: 'test-bucket', S3_ACCESS_KEY_ID: 'test-key' };

beforeEach(async () => {
  resetGoogleMocks();
  await setUpAuthedApp();
});

// A ".." segment (in any encoding — checked empirically with curl --path-as-is against a
// live server, both raw and percent-encoded) never survives Bun's own Request/URL
// construction: it gets collapsed before the request is even routed, so that specific
// sequence can never reach a handler regardless of whether validateKey() runs. The other
// characters validateKey() rejects — a null byte, a backslash, or a lone "." segment — are
// NOT touched by URL dot-segment normalization and do survive to reach the route as the
// literal {key} param, so those are what a real attacker (or a broken client) could still
// send, and what the missing validateKey() call on the named-param routes actually let through.
describe('key validation on /files/{key}', () => {
  test('named-param route (PUT /files/{key}) rejects an embedded null byte', async () => {
    const res = await app.request(`/api/v1/${TEST_APP_ID}/files/a%00b`, {
      method: 'PUT',
      headers: authHeaders(),
      body: 'data',
    }, S3_ENV);

    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe('Invalid key');
  });

  test('named-param route (GET /files/{key}) rejects an embedded backslash', async () => {
    const res = await app.request(`/api/v1/${TEST_APP_ID}/files/a%5cb`, { headers: authHeaders() }, S3_ENV);

    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe('Invalid key');
  });

  test('named-param route (DELETE /files/{key}) rejects a lone "." segment', async () => {
    const res = await app.request(`/api/v1/${TEST_APP_ID}/files/.`, {
      method: 'DELETE',
      headers: authHeaders(),
    }, S3_ENV);

    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe('Invalid key');
  });

  test('wildcard route (nested key) rejects an embedded null byte in a later segment', async () => {
    const res = await app.request(`/api/v1/${TEST_APP_ID}/files/a/b%00c`, {
      method: 'PUT',
      headers: authHeaders(),
      body: 'data',
    }, S3_ENV);

    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe('Invalid key');
  });
});
