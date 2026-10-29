import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Scheduler } from './scheduler.js';
const params = z.object({ id: z.string().min(1).max(64) }).strict();
export function registerScheduleRoutes(app: FastifyInstance, scheduler: Scheduler) {
  const repository = scheduler.repository;
  app.get('/api/schedules', () => repository.list());
  app.get('/api/schedules/:id', req => repository.get(params.parse(req.params).id));
  app.post('/api/schedules', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => reply.code(201).send(await scheduler.mutate(() => repository.save(req.body))));
  app.post('/api/schedules/:id', { bodyLimit: 4 * 1024 * 1024 }, req => scheduler.mutate(() => repository.save(req.body, params.parse(req.params).id)));
  for (const action of ['enable', 'disable', 'delete'] as const) app.post(`/api/schedules/:id/${action}`, req => {
    const { id } = params.parse(req.params);
    z.object({}).strict().parse(req.body);
    return scheduler.mutate(async () => action === 'delete' ? repository.remove(id) : repository.setEnabled(id, action === 'enable'));
  });
}
