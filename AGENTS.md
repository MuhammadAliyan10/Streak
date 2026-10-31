# Streak engineering guidance

- Keep this workspace on Node.js 22 LTS and pnpm workspaces.
- Mobile code must not import server modules, database drivers, or server credentials.
- Shared contracts must remain framework independent and portable to React Native.
- Keep Expo Router route files thin; place future domain behavior in feature modules.
- Validate environment variables and external input at the boundary with Zod.
- Never commit local environment files or credentials.
- Do not add product features before the Phase 1 architectural review.
