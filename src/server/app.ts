import Fastify from 'fastify';
import { metricHistory, historyBucketMinutes } from './metric-history.js';
import { poolAccountsSchema } from '../shared/pool-profiles.js';
import { registerPoolProfileRoutes } from './pool-profile-routes.js';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { registerTuningRoutes } from './tuning-routes.js';
import { Tuner } from './tuning.js';
import { FleetService } from './service.js';
import { AppError } from './errors.js';
import { settingsSchema, addressSchema, displayNameSchema } from '../shared/domain.js';

export async function createApp(db: PrismaClient, options: { service?: FleetService; tuner?: Tuner; webRoot?: string; dev?: boolean } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 16384, requestTimeout: 30000 });
  const service = options.service ?? new FleetService(db);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalidInput' });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.code });
    const code = (error as { statusCode?: number }).statusCode;
    if (code && code < 500) return reply.code(code).send({ error: 'invalidInput' });
    return reply.code(500).send({ error: 'operationFailed' });
  });
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host?.split(':')[0];
    if (!host || !['localhost', '127.0.0.1'].includes(host)) return reply.code(403).send({ error: 'forbidden' });
    const origin = req.headers.origin;
    if (origin) {
      const allowed = new Set([`http://${req.headers.host}`, ...(options.dev ? ['http://127.0.0.1:5173', 'http://localhost:5173'] : [])]);
      if (!allowed.has(origin)) return reply.code(403).send({ error: 'forbidden' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-bithive'] !== '1') return reply.code(403).send({ error: 'forbidden' });
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  registerPoolProfileRoutes(app, db);
  registerTuningRoutes(app, options.tuner ?? new Tuner(service));
  app.get('/api/health', () => ({ status: 'ok' }));
  app.get('/api/devices', () => service.list());
  app.post('/api/devices', async (req, reply) => {
    const body = z.object({ address: addressSchema, name: z.string().trim().max(80).optional() }).strict().parse(req.body);
    return reply.code(201).send(await service.register(body.address, body.name));
  });
  app.post('/api/demo', () => service.enableDemo());
  app.post('/api/devices/:id/restart', req => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).strict().parse(req.params);
    z.object({}).strict().parse(req.body);
    return service.restart(id);
  });
  app.post('/api/devices/:id/name', async req => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { name } = z.object({ name: displayNameSchema }).strict().parse(req.body);
    return service.renameDisplayName(id, name);
  });
  app.get('/api/devices/:id/profiles', async req => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!await db.device.findUnique({ where: { id } })) throw new AppError('notFound', 404);
    return (await db.profile.findMany({ where: { deviceId: id }, orderBy: { createdAt: 'asc' }, take: 20 })).map(p => ({ id: p.id, name: p.name, settings: JSON.parse(p.settings) }));
  });
  app.post('/api/devices/:id/profiles', async req => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({ name: z.string().trim().min(1).max(80), settings: z.object({
      frequency: z.number().int().min(1).max(65535).optional(), coreVoltage: z.number().int().min(1).max(65535).optional(),
      autofanspeed: z.union([z.literal(0), z.literal(1)]).optional(), manualFanSpeed: z.number().int().min(0).max(100).optional(),
    }).strict().refine(s => Object.keys(s).length > 0) }).strict().parse(req.body);
    if (!await db.device.findUnique({ where: { id } })) throw new AppError('notFound', 404);
    const profile = await db.$transaction(async tx => {
      if (await tx.profile.count({ where: { deviceId: id } }) >= 20) throw new AppError('profileLimit');
      return tx.profile.create({ data: { deviceId: id, name: body.name, settings: JSON.stringify(body.settings) } });
    });
    return { id: profile.id, name: profile.name, settings: JSON.parse(profile.settings) };
  });
  app.post('/api/batch', req => {
    const body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50).refine(ids => new Set(ids).size === ids.length),
      action: z.enum(['refresh', 'configure']), settings: settingsSchema.optional(), poolAccounts: poolAccountsSchema.optional(), customValuesAcknowledged: z.boolean().optional() }).strict()
      .refine(v => v.action !== 'configure' || v.settings !== undefined || v.poolAccounts !== undefined)
      .refine(v => v.action === 'configure' || v.poolAccounts === undefined)
      .refine(v => !v.poolAccounts || (v.settings?.hostname === undefined && (v.poolAccounts.primary === undefined || v.settings?.stratumUser === undefined) && (v.poolAccounts.fallback === undefined || v.settings?.fallbackStratumUser === undefined)))
      .refine(v => v.settings?.hostname === undefined || v.ids.length === 1).parse(req.body);
    return service.batch(body.ids, body.action, body.settings, body.customValuesAcknowledged, body.poolAccounts);
  });
  app.get('/api/devices/:id/history', async req => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const { hours, section, offset, pageSize } = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24),
      section: z.enum(['all', 'metrics', 'events', 'changes']).default('all'),
      offset: z.coerce.number().int().min(0).max(100000).default(0), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    if (!await db.device.findUnique({ where: { id } })) throw new AppError('notFound', 404);
    const since = new Date(Date.now() - hours * 3600000);
    const [metrics, events, changes] = await Promise.all([
      section === 'all' || section === 'metrics' ? metricHistory(db, id, hours).then(result => result.metrics) : [],
      section === 'all' || section === 'events' ? db.event.findMany({ where: { deviceId: id, timestamp: { gte: since } }, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], skip: offset, take: section === 'all' ? 100 : pageSize + 1 }) : [],
      section === 'all' || section === 'changes' ? db.configChange.findMany({ where: { deviceId: id, timestamp: { gte: since } }, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], skip: offset, take: section === 'all' ? 100 : pageSize + 1 }) : [],
    ]);
    return { metrics, bucketMinutes: historyBucketMinutes(hours), events: section === 'all' ? events : events.slice(0, pageSize), changes: section === 'all' ? changes : changes.slice(0, pageSize), limit: 1000, hasMore: section === 'events' ? events.length > pageSize : section === 'changes' ? changes.length > pageSize : false };
  });
  if (options.webRoot) {
    await app.register(staticFiles, { root: options.webRoot });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'notFound' }) : reply.sendFile('index.html'));
  }
  return app;
}
