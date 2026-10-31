# Development

Use Node.js 22 LTS (22.13 or newer) and pnpm 11.25.0. After registry access is available, install dependencies from the repository root with `pnpm install`.

- `pnpm dev:mobile` starts Expo and Metro.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` run workspace checks.
- `pnpm owner-token:generate` creates a private owner token and prints only its digest for provisioning.
- `pnpm test:functions` runs Function unit tests; `pnpm typecheck:functions` checks the Function and deployment config.

Expo Router is configured with `src/app` as its route root. Use the SDK-matched Expo CLI to check native package compatibility. A Metro bundle alone does not prove a native app launches or that authentication works on a device.

The `apps/api` folder is legacy Phase 1 source, excluded from the pnpm workspace and preserved as-is. Do not start or deploy it as part of Phase 2. Verify the Neon project and branch before applying [the owner and sync schema](../db/migrations/0001_private_owner_sync.sql); follow [environment.md](environment.md) to deploy the Function and configure the public endpoint.
