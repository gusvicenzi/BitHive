import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tuningConfigSchema } from '../shared/tuning.js';
import type { Tuner } from './tuning.js';

const deviceParams = z.object({ id: z.string().min(1).max(64) });
const runParams = deviceParams.extend({ runId: z.string().min(1).max(64) });
export function registerTuningRoutes(app: FastifyInstance, tuner: Tuner) {
  const base = '/api/devices/:id/tuning';
  app.get(base, req => tuner.list(deviceParams.parse(req.params).id));
  app.post(base, req => {
    const { requestKey, config } = z.object({ requestKey: z.string().min(1).max(128), config: tuningConfigSchema }).strict().parse(req.body);
    return tuner.create(deviceParams.parse(req.params).id, requestKey, config);
  });
  app.get(`${base}/:runId`, req => { const p = runParams.parse(req.params); return tuner.get(p.id, p.runId); });
  app.get(`${base}/:runId/results`, req => {
    const p = runParams.parse(req.params);
    const q = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    return tuner.results(p.id, p.runId, q.offset, q.limit);
  });
  for (const action of ['pause', 'resume', 'stop'] as const) app.post(`${base}/:runId/${action}`, req => {
    z.object({}).strict().parse(req.body); const p = runParams.parse(req.params); return tuner.control(p.id, p.runId, action);
  });
  app.post(`${base}/:runId/apply`, req => {
    const p = runParams.parse(req.params);
    const { category } = z.object({ category: z.enum(['hashrate', 'efficiency']) }).strict().parse(req.body);
    return tuner.applyWinner(p.id, p.runId, category);
  });
}
