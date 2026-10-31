import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/client.js';
import { registerHealthRoutes } from '../src/modules/health/routes.js';

describe('infrastructure routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('reports liveness without depending on the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('registers the Better Auth catch-all route', () => {
    expect(app.hasRoute({ method: 'GET', url: '/api/auth/*' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/auth/*' })).toBe(true);
  });

  it('returns 503 when a readiness dependency fails', async () => {
    const readinessApp = Fastify();
    await registerHealthRoutes(readinessApp, async () => {
      throw new Error('database unavailable');
    });

    const response = await readinessApp.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded' });
    await readinessApp.close();
  });

  it('returns ready when all readiness dependencies pass', async () => {
    const readinessApp = Fastify();
    await registerHealthRoutes(readinessApp, async () => undefined);

    const response = await readinessApp.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    await readinessApp.close();
  });
});
