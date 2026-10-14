import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3081', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: { command: 'npm start', url: 'http://localhost:3081/api/health', timeout: 120000, reuseExistingServer: false,
    env: { PORT: '3081', BITHIVE_DATA_DIR: mkdtempSync(join(tmpdir(), 'bithive-e2e-')) } },
});
