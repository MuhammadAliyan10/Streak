# Contributing

Thanks for helping improve Streak. Keep changes focused and preserve the local-first, single-user architecture described in `docs/architecture.md` and `AGENTS.md`.

## Development

1. Use Node.js 22 LTS and pnpm 11.25.0.
2. Install dependencies with `corepack pnpm install`.
3. Create a focused branch and make the smallest complete change.
4. Run the relevant checks before opening a pull request:

   ```sh
   corepack pnpm typecheck
   corepack pnpm lint
   corepack pnpm format:check
   corepack pnpm test:functions
   ```

Never commit `.env` files, database credentials, owner tokens, signing keys, or generated build artifacts. Do not use a real Neon database for tests; use a verified development branch and harmless test data.

## Pull requests

Describe the user-visible change, implementation approach, and checks run. Include screenshots for UI changes and call out any schema or security impact. Do not include unrelated formatting or generated files.
