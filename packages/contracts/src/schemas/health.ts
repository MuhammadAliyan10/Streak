import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  timestamp: z.string().datetime(),
});
