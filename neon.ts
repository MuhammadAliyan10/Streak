import { defineConfig } from '@neon/config/v1';

export default defineConfig({
  functions: {
    streak: {
      name: 'Streak private owner data',
      source: './neon/functions/streak.ts',
    },
  },
});
