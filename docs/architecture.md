# Architecture

## Workspace boundaries

- `apps/mobile` owns presentation, native integrations, navigation, local persistence, and client state.
- `packages/contracts` contains portable Zod schemas and inferred types. It must not import React Native, Expo, auth clients, or database packages.
- `neon` contains server-side Functions and their deployment configuration.

The mobile app uses Expo Router with routes under `src/app`. TanStack Query owns server state; local UI state stays near its feature until a concrete need for a shared store appears.

## Backend and private owner access

There is no separately hosted API or public sign-up flow. `neon/functions` contains the private data boundary. The app sends a high-entropy bearer token; Neon Functions compares its SHA-256 digest with the single provisioned row in `private.owner_access`. The raw token is stored only in Expo SecureStore on the device. It is never embedded in the bundle or logged. Token rotation validates the current token and atomically replaces the stored digest.

Neon injects `DATABASE_URL` into the deployed Function. It is read only by the server-side Function and is never exposed to React Native. Function queries use PostgreSQL parameters; the application tables are not granted to `PUBLIC`.

The existing `apps/api` directory remains untouched and excluded from the workspace. Do not run or deploy its self-hosted Better Auth server. Its generated auth migration must not be applied to Neon.

## Offline sync

SQLite keeps pending operations locally in a durable outbox. A successful authenticated Function request acknowledges operation IDs; retries are safe because Postgres uses a unique UUID and `ON CONFLICT DO NOTHING`. Failed requests leave the outbox rows in place. No habit or activity tables are introduced in this phase.

## Identifiers

`com.example.streak` is a valid placeholder Android/iOS application identifier. Replace it with an identifier controlled by the app owner before release.
