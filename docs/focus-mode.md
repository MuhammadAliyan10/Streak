# Focus sessions

Focus sessions are stored locally in SQLite and use the existing activity log and sync outbox. A session can run as a stopwatch or as a countdown. A countdown reaching zero moves the session to review; it does not save activity until the user confirms the credited duration.

## Timing and recovery

- While the JavaScript process is alive, elapsed time is calculated from a monotonic clock anchor plus persisted accumulated time. UI refreshes do not write to SQLite.
- Starting, pausing, resuming, finishing, recovery, and app foreground/background transitions are persisted.
- The timer continues while the app is backgrounded or the device is locked. Background transitions are recorded as possible interruptions, not evidence of distraction.
- After a process restart, the app offers a recovery estimate based on persisted UTC timestamps. The user must explicitly include or exclude that unconfirmed interval before continuing.
- A wall clock change detected when pausing or finishing sends the session to recovery review rather than silently adjusting its duration.
- Completed activity is split across local calendar dates in the session's saved time zone. Duration habit credit goes through the existing habit activity-log path; task completion is unchanged.

The app does not request background execution or keep the display awake. The elapsed display is timestamp based, so it remains accurate when the display sleeps. Device-specific behavior, haptics, and interruption handling still require final verification on Android and iOS native builds.
