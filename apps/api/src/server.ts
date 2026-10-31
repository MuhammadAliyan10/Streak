import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';

const app = await buildApp();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error({ err: error }, 'Failed to start API');
  await app.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => pool.end());
  });
}
