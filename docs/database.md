# Database

Neon Functions is the only cloud data path in this single-owner foundation. The private owner token is verified in the Function before any private database operation. PostgreSQL credentials stay in Neon's server-side Function environment; do not put database URLs in the app or developer `.env` files.

Review `db/migrations/0001_private_owner_sync.sql` and `db/migrations/0002_auth.sql` before applying them through the Neon SQL Editor, and only after verifying the target project and branch. Both migrations are additive and contain no secret values. Generate the first owner token with `pnpm owner-token:generate`, provision only its digest in the SQL Editor, then enter the token in the app's setup screen. Do not apply the legacy `apps/api/drizzle` migration.

The first owner registration is authorized by the existing generated owner token. Email/password accounts and sessions are stored in the `private` schema; passwords use scrypt and sessions store only SHA-256 token digests. Neon Functions are the only mobile database boundary. The app saves the returned session token in iOS SecureStore.

No Neon project link or verified development branch is configured in this repository. A database endpoint alone does not establish that it is the approved development target, so no migration has been run and no Neon Function has been deployed.
