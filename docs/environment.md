# Environment setup

Configure the deployed Neon Function's public HTTPS URL in `apps/mobile/.env` after deploying it to the verified branch.

## Mobile public endpoint

- `EXPO_PUBLIC_NEON_FUNCTIONS_URL`: branch-scoped Streak Function endpoint.

This endpoint is public configuration, not a secret. Do not place database URLs, migration credentials, Neon management keys, or service credentials in any `EXPO_PUBLIC_*` variable.

The deployed Function receives `DATABASE_URL` from Neon. Do not copy the connection string into a local env file or mobile configuration. The owner token is generated locally by `pnpm owner-token:generate`, then only its SHA-256 digest is provisioned in the Neon SQL Editor. The plaintext token is written to an ignored file with owner-only file permissions and must be entered in the app's setup screen.

`com.example.streak` remains a placeholder application identifier and must be replaced with an identifier controlled by the app owner before release.
