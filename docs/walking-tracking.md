# Optional walking distance tracking

Streak can read the current local day's walking/running distance for an eligible walking habit after the owner explicitly enables automatic tracking. Readings are stored only in local SQLite as replaceable daily snapshots. They are not added to the Neon sync outbox.

The mobile adapter uses `@appeeky/expo-healthkit` 0.4.2, verified for Expo SDK 57. It requests only HealthKit walking/running distance or Android Health Connect `READ_DISTANCE`. It does not request step counts, GPS, write permissions, or background delivery. The package is licensed under PolyForm Shield 1.0.0; review its license before redistributing a build.

Native verification requires:

- iOS 16.4 or later, with HealthKit enabled for the app's bundle identifier in the Apple Developer account.
- Android API 26 or later with Health Connect installed (built in on Android 14 and later).
- A custom native development build after installing the module and applying its Expo config plugin. Expo Go does not include the native module.

Android can report whether Health Connect granted the read permission. HealthKit does not disclose read authorization, so an empty result on iOS is reported as unconfirmed and never replaces manual progress. When a valid device snapshot exists for a day, it is the authoritative walking total for that day; manual entries remain in history but are excluded from that day's effective progress. Manual entries remain effective when no snapshot exists.
