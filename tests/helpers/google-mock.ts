// Replaces GoogleClient with mock functions so route tests never hit the real Sheets/Drive
// APIs. Spreads the real module first so RateLimitError/UpstreamError stay the actual
// classes — route code and test assertions both `instanceof`-check against the same
// definitions, and the mocked methods below can throw real instances of them.
import { mock } from 'bun:test';
import * as RealGoogle from '../../src/utils/google';

export const mockGoogleClient = {
  getAccessToken: mock(async () => 'fake-access-token'),
  getMasterSheetApps: mock(async (): Promise<any[]> => []),
  getHeaders: mock(async (): Promise<string[]> => []),
  setHeaders: mock(async () => {}),
  addColumn: mock(async () => {}),
  renameColumn: mock(async () => {}),
  deleteColumn: mock(async () => {}),
  listTabs: mock(async (): Promise<string[]> => []),
  createTab: mock(async () => {}),
  deleteTab: mock(async () => {}),
  getRows: mock(async (): Promise<any[]> => []),
  appendRow: mock(async () => {}),
  appendRows: mock(async () => {}),
  updateRow: mock(async () => {}),
  deleteRow: mock(async () => {}),
  deleteRows: mock(async () => {}),
  batchUpdateRows: mock(async () => {}),
  query: mock(async (): Promise<any[]> => []),
  createSpreadsheet: mock(async () => 'mock-spreadsheet-id'),
  moveToFolder: mock(async () => {}),
  deleteSpreadsheet: mock(async () => {}),
  appendMasterSheetApp: mock(async () => {}),
  rewriteMasterSheetApps: mock(async () => {}),
};

mock.module('../../src/utils/google', () => ({
  ...RealGoogle,
  GoogleClient: mockGoogleClient,
}));

// Clears call history and any per-test .mockResolvedValueOnce/.mockRejectedValueOnce queue,
// then restores the defaults above so tests don't leak state into each other.
export function resetGoogleMocks(): void {
  for (const fn of Object.values(mockGoogleClient)) fn.mockReset();
  mockGoogleClient.getMasterSheetApps.mockResolvedValue([]);
  mockGoogleClient.getHeaders.mockResolvedValue([]);
  mockGoogleClient.listTabs.mockResolvedValue([]);
  mockGoogleClient.getRows.mockResolvedValue([]);
  mockGoogleClient.query.mockResolvedValue([]);
}
