import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

export async function testDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'bithive-test-'));
  const url = `file:${join(dir, 'bithive.db').replaceAll('\\', '/')}`;
  const migrate = () => execFileSync(process.execPath, ['scripts/manage.mjs', 'migrate'], {
    env: { ...process.env, BITHIVE_DATA_DIR: dir }, stdio: 'pipe',
  });
  migrate();
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$connect();
  return { db, migrate, url, close: async () => { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}
