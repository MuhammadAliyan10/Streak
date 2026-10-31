# Database

Neon Functions is the only cloud data path in this single-owner foundation. The private owner token is verified in the Function before any private database operation. PostgreSQL credentials stay in Neon's server-side Function environment; do not put database URLs in the app or developer `.env` files.

Review `db/migrations/0001_private_owner_sync.sql` and apply it through the Neon SQL Editor only after verifying the target project and branch. The migration creates the singleton owner-token digest and idempotent sync table; it contains no secret value. Then generate the first owner token and run the printed `INSERT` once in the SQL Editor. Do not apply the legacy `apps/api/drizzle` migration.

This app does not use Neon Auth or a self-hosted authentication service. Its single-owner gate uses a generated high-entropy token whose digest is stored in a private schema and checked by Neon Functions.

No Neon project link or branch identifier is present in this repository. The connection string supplied earlier does not identify an approved development target by itself, so no migration has been run and no Neon service has been deployed.
