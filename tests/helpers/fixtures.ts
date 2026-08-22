import { hashApiKey } from '../../src/utils/crypto';
import { invalidateAppsCache, invalidateAppTokens } from '../../src/middleware/auth';
import { mockGoogleClient } from './google-mock';

export const TEST_ENV = {
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REFRESH_TOKEN: 'test-refresh-token',
  MASTER_SHEET_ID: 'test-master-sheet-id',
  ADMIN_SECRET: 'test-admin-secret',
};

export const TEST_APP_ID = 'testapp';
export const TEST_API_KEY = 'gsdb_test-key';
export const TEST_SPREADSHEET_ID = 'test-spreadsheet-id';

// Registers TEST_APP_ID/TEST_API_KEY as a valid app in the mocked Master Sheet and clears
// both cache layers appAuthMiddleware reads from, so each test starts from a clean auth
// state regardless of what a previous test cached.
export async function setUpAuthedApp(): Promise<void> {
  const api_key_hash = await hashApiKey(TEST_API_KEY);
  mockGoogleClient.getMasterSheetApps.mockResolvedValue([
    { app_id: TEST_APP_ID, spreadsheet_id: TEST_SPREADSHEET_ID, api_key_hash, created_at: '2026-01-01T00:00:00.000Z' },
  ]);
  invalidateAppsCache();
  invalidateAppTokens(TEST_APP_ID);
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}
