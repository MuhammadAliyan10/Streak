# Streak

Streak is an open-source, single-user productivity app foundation built with Expo and React Native. It is designed around private, local-first data and secure cloud sync. Habit-tracking features are planned for a later phase and are not part of the current foundation.

## Stack

- Expo, React Native, TypeScript, Expo Router, and NativeWind
- React Hook Form, Zod, TanStack Query, and Expo SQLite
- Expo SecureStore for the private owner credential
- Neon PostgreSQL and Neon Functions for cloud operations

## Getting started

Requirements: Node.js 22 LTS and pnpm 11.25.0.

```sh
corepack pnpm install
corepack pnpm dev:mobile
```

The local `.env.example` files are templates. Copy the mobile template to `apps/mobile/.env` and set `EXPO_PUBLIC_NEON_FUNCTIONS_URL` only after deploying the Neon Function. Never place a database URL, password, Neon API key, or owner token in the mobile app or a committed file. See [docs/development.md](docs/development.md) and [docs/environment.md](docs/environment.md).

Neon project linking, migration application, and Function deployment require a verified development branch; this repository does not contain production credentials or a preconfigured Neon project link.

## Checks

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test:functions
```

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please report security issues privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

Streak is licensed under the [MIT License](LICENSE).
