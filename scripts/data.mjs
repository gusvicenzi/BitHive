import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function configureData() {
  const dir = resolve(process.env.BITHIVE_DATA_DIR || join(root, 'data'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const database = join(dir, 'bithive.db');
  // Prisma 6 migrate deploy expects an existing target file. Exclusive creation
  // bootstraps a fresh SQLite file without ever truncating an existing database.
  try { closeSync(openSync(database, 'wx', 0o600)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  return dir;
}
