import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { FleetService } from './service.js';
import { Collector } from './collector.js';

const db = new PrismaClient();
const service = new FleetService(db);
const app = await createApp(db, { service, webRoot: process.env.BITHIVE_DEV ? undefined : resolve('dist/web'), dev: process.env.BITHIVE_DEV === '1' });
const collector = new Collector(service, () => console.error('Collection failed; retrying on the next cycle.'));
const port = Number(process.env.PORT ?? 3080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
app.addHook('onClose', async () => { await collector.stop(); await db.$disconnect(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port });
collector.start();
console.log(`BitHive is ready at http://localhost:${port}`);
