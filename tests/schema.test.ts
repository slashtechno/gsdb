import { describe, test, expect, beforeEach } from 'bun:test';
import { mockGoogleClient, resetGoogleMocks } from './helpers/google-mock';
import { setUpAuthedApp, authHeaders, TEST_ENV, TEST_APP_ID, TEST_SPREADSHEET_ID } from './helpers/fixtures';
import { jsonBody } from './helpers/json';
import app from '../src/index';

beforeEach(async () => {
  resetGoogleMocks();
  await setUpAuthedApp();
});

async function putSchema(columns: string[]) {
  return app.request(`/api/v1/${TEST_APP_ID}/users/schema`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  }, TEST_ENV);
}

describe('PUT /{table}/schema', () => {
  test('reordering existing columns keeps their physical order (data stays under the right label)', async () => {
    mockGoogleClient.getHeaders.mockResolvedValue(['name', 'email']);

    const res = await putSchema(['email', 'name']); // client asks for a swapped order

    expect(res.status).toBe(200);
    // setHeaders must receive the ORIGINAL physical order, not the client's requested
    // order — reordering the header text without moving cells would relabel column data.
    expect(mockGoogleClient.setHeaders).toHaveBeenCalledWith(TEST_ENV, TEST_SPREADSHEET_ID, 'users', ['name', 'email']);
    expect(mockGoogleClient.deleteColumn).not.toHaveBeenCalled();
    const body = await jsonBody(res);
    expect(body.columns).toEqual(['name', 'email']);
  });

  test('inserting a new column mid-list appends it, keeping retained columns in place', async () => {
    mockGoogleClient.getHeaders.mockResolvedValue(['name', 'email']);

    const res = await putSchema(['name', 'phone', 'email']);

    expect(res.status).toBe(200);
    expect(mockGoogleClient.setHeaders).toHaveBeenCalledWith(TEST_ENV, TEST_SPREADSHEET_ID, 'users', ['name', 'email', 'phone']);
    const body = await jsonBody(res);
    expect(body.columns).toEqual(['name', 'email', 'phone']);
  });

  test('omitting a column deletes it and its data', async () => {
    mockGoogleClient.getHeaders.mockResolvedValue(['name', 'email', 'role']);

    const res = await putSchema(['name', 'email']);

    expect(res.status).toBe(200);
    expect(mockGoogleClient.deleteColumn).toHaveBeenCalledWith(TEST_ENV, TEST_SPREADSHEET_ID, 'users', 'role');
    expect(mockGoogleClient.setHeaders).toHaveBeenCalledWith(TEST_ENV, TEST_SPREADSHEET_ID, 'users', ['name', 'email']);
  });
});
