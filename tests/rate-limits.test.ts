import { describe, test, expect, beforeEach } from 'bun:test';
import './helpers/google-mock';
import { mockGoogleClient, resetGoogleMocks } from './helpers/google-mock';
import { setUpAuthedApp, authHeaders, TEST_ENV, TEST_APP_ID } from './helpers/fixtures';
import { RateLimitError, UpstreamError } from '../src/utils/google';
import { jsonBody } from './helpers/json';
import app from '../src/index';

beforeEach(async () => {
  resetGoogleMocks();
  await setUpAuthedApp();
});

describe('rate-limit contract', () => {
  test('RateLimitError from a route handler becomes 429 with Retry-After', async () => {
    mockGoogleClient.listTabs.mockRejectedValue(new RateLimitError(30));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = await jsonBody(res);
    expect(body).toEqual({ error: 'Google Sheets API rate limit exceeded', retryAfter: 30 });
  });

  test('RateLimitError with no Retry-After from Google falls back to a default', async () => {
    mockGoogleClient.listTabs.mockRejectedValue(new RateLimitError(null));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = await jsonBody(res);
    expect(body.retryAfter).toBe(60);
  });

  test('UpstreamError becomes 502, distinct from a rate limit', async () => {
    mockGoogleClient.listTabs.mockRejectedValue(new UpstreamError('Failed to list tabs: 503', 503));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(502);
    expect(res.headers.get('Retry-After')).toBeNull();
    const body = await jsonBody(res);
    expect(body.error).toContain('Failed to list tabs');
  });

  test('a plain business-logic Error becomes 400, not 429/502', async () => {
    mockGoogleClient.addColumn.mockRejectedValue(new Error('Column "email" already exists'));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/users/schema/email`, {
      method: 'POST',
      headers: authHeaders(),
    }, TEST_ENV);

    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe('Column "email" already exists');
  });

  test('a rate limit during auth (Master Sheet fetch) surfaces as 429, not a bare 500', async () => {
    // Simulates a cache-miss racing a Google rate limit — appAuthMiddleware calls
    // getMasterSheetApps itself, ahead of any route handler running.
    mockGoogleClient.getMasterSheetApps.mockRejectedValue(new RateLimitError(15));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, { headers: authHeaders() }, TEST_ENV);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('15');
  });

  test('Retry-After is exposed through CORS for browser-based consumers', async () => {
    mockGoogleClient.listTabs.mockRejectedValue(new RateLimitError(30));

    const res = await app.request(`/api/v1/${TEST_APP_ID}/tables`, {
      headers: { ...authHeaders(), Origin: 'https://example.com' },
    }, TEST_ENV);

    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
  });
});
