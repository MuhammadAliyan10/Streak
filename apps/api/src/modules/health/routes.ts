import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@streak/contracts';
import { pool } from '../../db/client.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  checkDatabase: () => Promise<unknown> = () => pool.query('select 1'),
): Promise<void> {
  app.get('/health/live', async () =>
    healthResponseSchema.parse({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  app.get('/health/ready', async (_request, reply) => {
    try {
      await checkDatabase();
      return healthResponseSchema.parse({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (error) {
      app.log.error({ err: error }, 'Readiness database check failed');
      return reply.status(503).send({ status: 'degraded', timestamp: new Date().toISOString() });
    }
  });
}
