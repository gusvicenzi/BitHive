import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { PoolProfileRepository } from './pool-profile-repository.js';

export function registerPoolProfileRoutes(app: FastifyInstance, db: PrismaClient) {
  const profiles = new PoolProfileRepository(db);
  const params = z.object({ id: z.string().min(1).max(64) });
  app.get('/api/pool-profiles', () => profiles.list());
  app.post('/api/pool-profiles', async (req, reply) => reply.code(201).send(await profiles.save(req.body)));
  app.post('/api/pool-profiles/:id', req => profiles.save(req.body, params.parse(req.params).id));
  app.post('/api/pool-profiles/:id/delete', req => {
    z.object({}).strict().parse(req.body);
    return profiles.remove(params.parse(req.params).id);
  });
}
