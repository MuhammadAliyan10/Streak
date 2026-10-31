import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env, trustedOrigins } from './config/env.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { auth } from './modules/auth/auth.js';
import { fromNodeHeaders } from 'better-auth/node';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.set-cookie',
          '*.password',
          '*.token',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: (origin, callback) => {
      const expoDevelopmentOrigin = env.NODE_ENV === 'development' && origin?.startsWith('exp://');
      if (!origin || trustedOrigins.includes(origin) || expoDevelopmentOrigin) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed'), false);
    },
    credentials: true,
  });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, 'Request failed');
    const candidateStatusCode =
      error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const statusCode =
      typeof candidateStatusCode === 'number' &&
      candidateStatusCode >= 400 &&
      candidateStatusCode < 500
        ? candidateStatusCode
        : 500;
    return reply.status(statusCode).send({
      error:
        statusCode === 500
          ? 'Internal Server Error'
          : error instanceof Error
            ? error.message
            : 'Request failed',
      statusCode,
    });
  });

  await registerHealthRoutes(app);
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      try {
        const url = new URL(request.url, env.BETTER_AUTH_URL);
        const headers = fromNodeHeaders(request.headers);
        const body = request.body;
        const authRequest = new Request(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const response = await auth.handler(authRequest);
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header('set-cookie', cookies);
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        request.log.error({ err: error }, 'Authentication request failed');
        return reply
          .status(500)
          .send({ error: 'Internal authentication error', code: 'AUTH_FAILURE' });
      }
    },
  });

  return app;
}
