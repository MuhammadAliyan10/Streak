export function isWalkingDistanceHabit(name: string, measurement: string): boolean {
  return measurement === 'distance' && /\bwalk(?:ing|s)?\b/i.test(name);
}

export function effectiveWalkingProgress(
  manualMeters: number,
  deviceMeters: number | null,
): number {
  return deviceMeters ?? manualMeters;
}

function offsetAt(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(fields.year),
    Number(fields.month) - 1,
    Number(fields.day),
    Number(fields.hour),
    Number(fields.minute),
    Number(fields.second),
  );
  return zonedAsUtc - date.getTime();
}

export function localDayBounds(day: string, timezone: string): { from: Date; to: Date } {
  const [yearPart, monthPart, datePart] = day.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const date = Number(datePart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(date)) {
    throw new RangeError('Invalid local date.');
  }
  const start = Date.UTC(year, month - 1, date);
  const end = Date.UTC(year, month - 1, date + 1);
  const zoned = (utc: number) => {
    const initial = new Date(utc);
    const first = new Date(utc - offsetAt(initial, timezone));
    return new Date(utc - offsetAt(first, timezone));
  };
  return { from: zoned(start), to: zoned(end) };
}
