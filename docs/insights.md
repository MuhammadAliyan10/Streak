# Insights and daily review

Insights derives its values from existing local SQLite records. Presets cover today, the last 7 days, and the last 30 days. Custom ranges are validated and capped below 90 days. Recent streak calculations use a bounded history window and are labeled with that window.

- Habit consistency is completed or confirmed-clean scheduled days divided by eligible scheduled days. Unscheduled, paused, unknown bad-habit days, pending days, and the current unfinished day are excluded. Skipped and partial finalized days remain eligible but do not count as complete, matching existing streak rules.
- Focus time uses active saved focus-session activity allocations, so credited duration is split by the session's local dates. Deleted or superseded session logs are excluded. Period comparison is shown only for completed equivalent periods with prior data.
- Goal progress comes from the existing goal calculation. Routine and task counts use existing run and task records. Activity category counts use recorded non-focus logs with a saved category; missing categories are not invented.
- Manual digital increments remain partial. A confirmed daily total replaces same-day increments. Automatic walking snapshots replace manual distance only for the snapshot date; manual entries remain available on other dates.
- Daily reviews are date-keyed and editable. Migration v10 adds three optional reflection fields and copies prior review text into “What went well?” without deleting the original note.

Insights does not collect new data, add analytics tables, send cloud analytics, or calculate an overall productivity score.
