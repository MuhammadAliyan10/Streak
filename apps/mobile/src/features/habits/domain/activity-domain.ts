import { z } from 'zod';

export const measurementKinds = [
  'volume',
  'duration',
  'distance',
  'count',
  'pages',
  'quantity',
] as const;
export type MeasurementKind = (typeof measurementKinds)[number];

type UnitDefinition = { label: string; canonical: string; factor: number; integerOnly?: boolean };
const definitions: Record<MeasurementKind, Record<string, UnitDefinition>> = {
  volume: {
    ml: { label: 'mL', canonical: 'mL', factor: 1 },
    l: { label: 'L', canonical: 'mL', factor: 1000 },
    oz: { label: 'fl oz', canonical: 'mL', factor: 29.5735295625 },
    cup: { label: 'cup', canonical: 'mL', factor: 240 },
  },
  duration: {
    s: { label: 'sec', canonical: 'seconds', factor: 1, integerOnly: true },
    min: { label: 'min', canonical: 'seconds', factor: 60 },
    h: { label: 'hr', canonical: 'seconds', factor: 3600 },
  },
  distance: {
    m: { label: 'm', canonical: 'meters', factor: 1 },
    km: { label: 'km', canonical: 'meters', factor: 1000 },
    mi: { label: 'mi', canonical: 'meters', factor: 1609.344 },
  },
  count: {
    count: { label: 'count', canonical: 'count', factor: 1, integerOnly: true },
    reps: { label: 'reps', canonical: 'reps', factor: 1, integerOnly: true },
    glasses: { label: 'glasses', canonical: 'glasses', factor: 1, integerOnly: true },
  },
  pages: { page: { label: 'pages', canonical: 'pages', factor: 1, integerOnly: true } },
  quantity: {},
};

const aliases: Record<string, string> = {
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  'fluid ounce': 'oz',
  'fluid ounces': 'oz',
  ounces: 'oz',
  ounce: 'oz',
  minutes: 'min',
  minute: 'min',
  seconds: 's',
  second: 's',
  hours: 'h',
  hour: 'h',
  hrs: 'h',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  kilometers: 'km',
  kilometer: 'km',
  kilometres: 'km',
  kilometre: 'km',
  miles: 'mi',
  mile: 'mi',
  times: 'count',
  time: 'count',
  page: 'page',
  pages: 'page',
  glass: 'glasses',
  repetition: 'reps',
  repetitions: 'reps',
  rep: 'reps',
};

function normalizedUnit(unit: string): string {
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases[normalized] ?? normalized;
}

export function measurementForHabit(measurement: string, unit: string): MeasurementKind {
  if (measurement === 'duration') return 'duration';
  if (measurement === 'distance') return 'distance';
  if (measurement === 'count') return 'count';
  if (measurement === 'quantity' && normalizedUnit(unit) === 'page') return 'pages';
  if (measurement === 'quantity' && ['ml', 'l', 'oz', 'cup'].includes(normalizedUnit(unit))) {
    return 'volume';
  }
  if (measurement === 'quantity') return 'quantity';
  return 'count';
}

export function unitsForMeasurement(kind: MeasurementKind, configuredUnit?: string): string[] {
  if (kind === 'quantity') return configuredUnit ? [configuredUnit] : [];
  return Object.values(definitions[kind]).map(({ label }) => label);
}

function definition(kind: MeasurementKind, unit: string): UnitDefinition {
  const normalized = normalizedUnit(unit);
  const known = definitions[kind][normalized];
  if (known) return known;
  if (kind === 'quantity' && normalized.length >= 1 && normalized.length <= 24) {
    return { label: unit.trim(), canonical: `milli:${normalized}`, factor: 1000 };
  }
  throw new Error(`Choose a supported ${kind} unit.`);
}

export function toCanonical(
  value: number,
  kind: MeasurementKind,
  unit: string,
): {
  value: number;
  unit: string;
} {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error('Enter a positive amount within the supported range.');
  }
  const spec = definition(kind, unit);
  if (spec.integerOnly && !Number.isInteger(value)) {
    throw new Error(`${spec.label} must be a whole number.`);
  }
  const canonicalValue = Math.round(value * spec.factor);
  if (
    !Number.isSafeInteger(canonicalValue) ||
    canonicalValue < 1 ||
    canonicalValue > 2_147_483_647
  ) {
    throw new Error('That amount is outside the supported range.');
  }
  return { value: canonicalValue, unit: spec.canonical };
}

export function fromCanonical(value: number, kind: MeasurementKind, unit: string): number {
  return value / definition(kind, unit).factor;
}

export const activityFormSchema = z
  .object({
    title: z.string().trim().max(80),
    category: z.enum([
      'habit',
      'water',
      'study',
      'reading',
      'walking',
      'exercise',
      'nutrition',
      'other',
    ]),
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount.'),
    unit: z.string().trim().min(1).max(24),
    note: z.string().trim().max(280),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time.'),
    timezone: z.string().min(1),
  })
  .superRefine((value, context) => {
    const number = Number(value.amount);
    if (!Number.isFinite(number) || number <= 0 || number > 1_000_000_000) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Enter a positive amount within the supported range.',
      });
    }
    if (value.title.length < 2 && value.category === 'other') {
      context.addIssue({ code: 'custom', path: ['title'], message: 'Name this activity.' });
    }
    const date = new Date(`${value.localDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.localDate) {
      context.addIssue({ code: 'custom', path: ['localDate'], message: 'Choose a valid date.' });
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(new Date());
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['timezone'],
        message: 'Choose a valid time zone.',
      });
    }
  });

export const presetSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(32),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid amount.'),
  unit: z.string().trim().min(1).max(24),
  isDefault: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});
export type ActivityForm = z.infer<typeof activityFormSchema>;
export type PresetInput = z.infer<typeof presetSchema>;

export function timestampFromLocal(localDate: string, localTime: string, timezone: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  let candidate = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
    );
    const delta = Date.UTC(year!, month! - 1, day!, hour!, minute!) - represented;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate).toISOString();
}
