# Product rules for future feature work

These rules define future domain behavior; this phase does not implement these features or create their database tables.

## Habit scheduling

- A fixed schedule represents an activity at a particular local time with a defined target.
- A windowed schedule represents completion during a configurable local start/end interval.
- Schedules must support recurrence and future exceptions.
- Completion is evaluated against the scheduled local calendar day, never an arbitrary rolling 24-hour period.

## Measurements

Each activity declares one measurement type: completion count, duration, distance, repetitions, or quantity. Do not assume every activity is duration-based.

## Time and dates

- Store absolute event instants in UTC and preserve the user's IANA time zone.
- Keep calendar dates distinct from UTC timestamps.
- Account for daylight-saving transitions and changes to the user's time zone.
- Elapsed wall-clock time does not prove uninterrupted activity.

## Notifications

Plan for local scheduling, configurable reminders, permission handling, cancellation, and rescheduling. Notification delivery never determines whether an activity was completed.

## Stopwatch and distance

Stopwatch sessions need pause, resume, persistence, crash handling, and restart recovery. Manual distance entries come first; GPS tracking later requires explicit permission and platform-specific handling.

## Offline-first behavior

Future writes should use local persistence, stable IDs, idempotency, and conflict-aware synchronization. No sync engine is in this phase.
