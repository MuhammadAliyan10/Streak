# Development

Use Node.js 22 LTS (22.13 or newer) and pnpm 11.25.0. After registry access is available, install dependencies from the repository root with `pnpm install`.

- `pnpm dev:mobile` starts Expo and Metro.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` run workspace checks.
- `pnpm owner-token:generate` creates a private owner token and prints only its digest for provisioning.
- `pnpm test:functions` runs Function unit tests; `pnpm typecheck:functions` checks the Function and deployment config.

Expo Router is configured with `src/app` as its route root. Use the SDK-matched Expo CLI to check native package compatibility. A Metro bundle alone does not prove a native app launches or that authentication works on a device.

Shared mobile UI lives under `apps/mobile/src/components`: use `ScreenLayout` for safe areas, keyboard handling, shared gutters and fixed chrome; `AppHeader`, `BottomNavigation`, `Button`, `IconButton`, and the single `ToastProvider` for repeated controls. Keep common spacing in `src/theme/tokens.ts` and NativeWind colors in `tailwind.config.js`.

Use `react-timer-hook` for stopwatch/countdown controls when timer screens are added. Its update interval drives display refreshes; elapsed time must be based on persisted start/pause timestamps in SQLite. On `AppState` returning to `active`, recalculate from those timestamps instead of relying on JavaScript to tick in the background. See the [timer hook](https://github.com/amrlabib/react-timer-hook) and [React Native AppState](https://reactnative.dev/docs/appstate) references.

The `apps/api` folder is legacy Phase 1 source, excluded from the pnpm workspace and preserved as-is. Do not start or deploy it as part of Phase 2. Verify the Neon project and branch before applying [the owner and sync schema](../db/migrations/0001_private_owner_sync.sql); follow [environment.md](environment.md) to deploy the Function and configure the public endpoint.
