# Shared mobile UI

Use the shared components in `apps/mobile/src/components` to keep screen spacing and control behavior consistent.

- `layout/ScreenLayout` supplies safe areas, keyboard-aware scrolling, standard gutters, and optional fixed header/navigation slots.
- `layout/AppHeader` displays a title and subtitle with an optional right-side action.
- `ui/Button` provides primary, secondary, and quiet actions with common sizes, loading state, disabled state, and icon slots.
- `ui/IconButton` provides a consistent accessible touch target with disabled and loading states.
- `ui/BottomNavigation` accepts exactly three navigation items and visually emphasizes the center item.
- `ui/FormTextField`, `ui/FormMessage`, `ui/ErrorState`, and `ui/EmptyState` are the common form and feedback elements.
- `feedback/ToastProvider` is mounted once in `AppProviders`; call `useToast()` to show one global toast at a time.

Use the spacing values from `src/theme/tokens.ts`, Indigo `#4F46E5` from `tailwind.config.js`, and the shared component classes. Add another package only when a common control cannot be built from the installed Expo and React Native primitives.
