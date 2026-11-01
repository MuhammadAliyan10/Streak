# Digital usage tracking

Digital usage is an opt-in habit type. It uses the existing habit, goal, activity, Today, and reminder flows.

- Duration limits are stored as integer seconds; count limits use integer counts.
- Quick entries add to the day. A confirmed daily total replaces those additions for progress and streak calculations, so the values are never added together.
- Missing data stays unknown. A partial value is not a confirmed day, and an unrecorded day is not considered clean.
- Daily totals remain in local SQLite and are not sent to Neon by default.
- This build supports manual entry only. It does not request usage permissions or poll apps.
- Android automatic usage would require a verified native `UsageStatsManager` integration and explicit Usage Access. iOS usage reports require the Family Controls entitlement and remain sandboxed in `DeviceActivityReport`; Streak does not export report contents.

The local SQLite migration is version 9 and additive. No native projects, device APIs, or permissions are changed by this feature.
