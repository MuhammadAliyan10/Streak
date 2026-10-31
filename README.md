# Streak

Streak is a pnpm workspace for a React Native / Expo application and portable shared contracts. Neon is the intended managed identity and data platform; there is no active separately hosted API.

## Requirements

- Node.js 22 LTS (22.13 or newer)
- pnpm 11.25.0 (Corepack can activate the version recorded in `package.json`)
- A verified Neon development branch for future migrations

See [docs/development.md](docs/development.md) to run the mobile app and Neon Function. The single-owner access flow uses a high-entropy token stored in SecureStore and verified by the Function.
