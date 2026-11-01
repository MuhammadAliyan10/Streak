import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { Button } from '../../components/ui/button';
import { FormTextField } from '../../components/ui/form-text-field';
import {
  activityFormSchema,
  measurementForHabit,
  presetSchema,
  timestampFromLocal,
  unitsForMeasurement,
  type ActivityForm,
  type MeasurementKind,
  type PresetInput,
} from './domain/activity-domain';
import type { ActivityEntry, ActivityPreset, HabitRecord, QuickActivity } from './habit-repository';
import {
  deleteHabitPreset,
  getHabitForDate,
  newActivityKey,
  saveHabitPreset,
} from './habit-repository';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const categories = [
  { key: 'water', label: 'Water', measurement: 'volume', unit: 'mL' },
  { key: 'study', label: 'Study', measurement: 'duration', unit: 'min' },
  { key: 'reading', label: 'Reading', measurement: 'pages', unit: 'pages' },
  { key: 'walking', label: 'Walking', measurement: 'distance', unit: 'km' },
  { key: 'exercise', label: 'Exercise', measurement: 'duration', unit: 'min' },
  { key: 'nutrition', label: 'Nutrition', measurement: 'quantity', unit: 'servings' },
  { key: 'other', label: 'Other', measurement: 'count', unit: 'count' },
] as const;
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function localTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function timeInZone(timestamp: string, zone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}
function displayDate(timestamp: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function pickerDate(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year || 2000, (month || 1) - 1, day || 1, hours || 0, minutes || 0);
}

export function MeasurementProgress({ habit }: { habit: HabitRecord }) {
  const percent =
    habit.targetValue > 0 ? Math.round((habit.progress / habit.targetValue) * 100) : 0;
  const remaining = Math.max(0, habit.targetValue - habit.progress);
  const excess = Math.max(0, habit.progress - habit.targetValue);
  const isWater = measurementForHabit(habit.measurement, habit.unit) === 'volume';
  return (
    <View className={`mt-3 rounded-2xl p-3 ${isWater ? 'bg-sky-50' : 'bg-slate-50'}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View
            className={`mr-2 h-9 w-6 justify-end overflow-hidden rounded-b-lg rounded-t-md border ${isWater ? 'border-sky-300 bg-white' : 'border-indigo-200 bg-white'}`}
          >
            <View
              className={`w-full ${isWater ? 'bg-sky-400' : 'bg-indigo-400'}`}
              style={{ height: `${Math.min(100, percent)}%` }}
            />
          </View>
          <Text className="text-sm font-semibold text-ink">
            {habit.digitalUsage
              ? `${habit.progress} ${habit.unit} / ${habit.targetValue} ${habit.unit} maximum`
              : `${habit.progress} / ${habit.targetValue} ${habit.unit}`}
          </Text>
        </View>
        <Text className="text-xs font-medium text-slate-600">
          {habit.digitalUsage
            ? excess
              ? `${excess} ${habit.unit} over limit`
              : habit.usageStatus === 'within_limit'
                ? `${remaining} ${habit.unit} allowance · confirmed`
                : habit.usageStatus === 'below_so_far'
                  ? `${remaining} ${habit.unit} left so far`
                  : 'No usage total yet'
            : remaining
              ? `${remaining} ${habit.unit} left`
              : `${percent}% · target reached`}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: habit.targetValue,
          now: Math.min(habit.progress, habit.targetValue),
        }}
        className="mt-2 h-2 overflow-hidden rounded-full bg-white"
      >
        <View
          className={`h-full rounded-full ${isWater ? 'bg-sky-500' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </View>
      {!habit.digitalUsage && habit.progress > habit.targetValue ? (
        <Text className="mt-1 text-xs text-slate-600">
          Actual total: {habit.progress} {habit.unit}
        </Text>
      ) : null}
    </View>
  );
}

export function QuickPresetButton({
  habit,
  preset,
  disabled,
  loading,
  onPress,
}: {
  habit: HabitRecord;
  preset: ActivityPreset;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Log ${preset.name}, ${preset.inputValue} ${preset.inputUnit} for ${habit.name}`}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled}
      onPress={onPress}
      className="mr-2 min-h-12 justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 active:bg-indigo-100"
    >
      <Text className="text-sm font-semibold text-primary">+ {preset.name}</Text>
      <Text className="mt-0.5 text-xs text-indigo-700">
        {preset.inputValue} {preset.inputUnit}
      </Text>
    </Pressable>
  );
}

function PresetForm({
  habit,
  preset,
  onClose,
  onSaved,
}: {
  habit: HabitRecord;
  preset?: ActivityPreset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm<PresetInput>({
    resolver: zodResolver(presetSchema),
    defaultValues: {
      name: preset?.name ?? '',
      amount: String(
        preset?.inputValue ?? Math.max(1, Math.round(habit.configuredTargetValue / 4)),
      ),
      unit: preset?.inputUnit ?? habit.configuredUnit,
      isDefault: preset?.isDefault ?? false,
      sortOrder: preset?.sortOrder ?? 0,
    },
  });
  const [unit, setUnit] = useState(preset?.inputUnit ?? habit.configuredUnit);
  const saving = useMutation({
    mutationFn: (values: PresetInput) => saveHabitPreset(habit, { ...values, unit }, preset?.id),
    onSuccess: onSaved,
    onError: () =>
      form.setError('name', { type: 'server', message: 'Could not save this quick action.' }),
  });
  const kind = measurementForHabit(habit.measurement, habit.unit);
  const units = unitsForMeasurement(kind, habit.configuredUnit);
  return (
    <View className="rounded-t-3xl bg-canvas p-5">
      <Text className="mb-1 text-xl font-bold text-ink">
        {preset ? 'Edit preset' : 'New quick action'}
      </Text>
      <Text className="mb-5 text-sm text-slate-600">
        The saved log keeps its own quantity if this preset changes later.
      </Text>
      <FormTextField
        control={form.control}
        name="name"
        label="Button name"
        placeholder="e.g. My Glass"
        autoCapitalize="words"
      />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormTextField
            control={form.control}
            name="amount"
            label="Amount"
            placeholder="250"
            keyboardType="decimal-pad"
          />
        </View>
        <View className="flex-1 justify-center">
          <Text className="mb-2 text-sm font-medium text-ink">Unit</Text>
          <View className="flex-row flex-wrap gap-2">
            {units.map((choice) => (
              <Pressable
                key={choice}
                accessibilityRole="radio"
                accessibilityState={{ selected: unit === choice }}
                onPress={() => setUnit(choice)}
                className={`min-h-10 justify-center rounded-lg border px-3 ${unit === choice ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'}`}
              >
                <Text className="text-sm text-ink">{choice}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: form.watch('isDefault') }}
        onPress={() =>
          form.setValue('isDefault', !form.getValues('isDefault'), { shouldDirty: true })
        }
        className="mb-4 min-h-11 flex-row items-center"
      >
        <Text className="mr-2 text-lg text-primary">{form.watch('isDefault') ? '☑' : '□'}</Text>
        <Text className="text-sm text-ink">Make this the default quick action</Text>
      </Pressable>
      <View className="gap-3">
        <Button
          title="Save preset"
          loading={saving.isPending}
          onPress={form.handleSubmit((values) => saving.mutateAsync(values))}
        />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
        {preset ? (
          <Button
            title="Delete preset"
            variant="quiet"
            disabled={saving.isPending}
            onPress={() =>
              Alert.alert(
                'Delete preset?',
                'Existing activity logs keep the original preset name and quantity.',
                [
                  { text: 'Keep', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await deleteHabitPreset(habit.id, preset.id);
                        onSaved();
                      } catch {
                        Alert.alert('Could not delete preset', 'Try again.');
                      }
                    },
                  },
                ],
              )
            }
          />
        ) : null}
      </View>
    </View>
  );
}

export function PresetManagerSheet({
  visible,
  habit,
  presets,
  onClose,
  onChanged,
}: {
  visible: boolean;
  habit: HabitRecord;
  presets: ActivityPreset[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ActivityPreset | null | undefined>();
  useEffect(() => {
    if (!visible) setEditing(undefined);
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <View className="max-h-[85%] rounded-t-3xl bg-canvas p-5">
          {editing !== undefined ? (
            <PresetForm
              key={editing?.id ?? 'new'}
              habit={habit}
              {...(editing ? { preset: editing } : {})}
              onClose={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined);
                onChanged();
              }}
            />
          ) : (
            <>
              <Text className="mb-1 text-xl font-bold text-ink">Quick actions</Text>
              <Text className="mb-4 text-sm text-slate-600">
                Tap a preset to edit it. Keep your favorites at the top.
              </Text>
              {presets.map((preset) => (
                <Pressable
                  key={preset.id}
                  accessibilityRole="button"
                  onPress={() => setEditing(preset)}
                  className="mb-2 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white p-3"
                >
                  <View>
                    <Text className="font-semibold text-ink">
                      {preset.name}
                      {preset.isDefault ? ' · Default' : ''}
                    </Text>
                    <Text className="mt-1 text-xs text-slate-600">
                      {preset.inputValue} {preset.inputUnit}
                    </Text>
                  </View>
                  <Text className="text-primary">Edit</Text>
                </Pressable>
              ))}
              <View className="gap-3 pt-2">
                <Button title="Add preset" onPress={() => setEditing(null)} />
                <Button title="Done" variant="secondary" onPress={onClose} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function ActivityLogSheet({
  visible,
  habit,
  existing,
  preset,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  habit: HabitRecord | null;
  existing?: ActivityEntry;
  preset?: ActivityPreset;
  onClose: () => void;
  onSave: (input: QuickActivity, existingId?: string) => Promise<void>;
  onDelete?: () => void;
}) {
  const now = new Date();
  const defaultCategory =
    categories.find((item) => item.key === (existing?.category ?? 'water')) ?? categories[0]!;
  const initialValue = existing?.input_value ?? preset?.inputValue ?? '';
  const initialUnit =
    existing?.input_unit ?? preset?.inputUnit ?? (habit?.configuredUnit || defaultCategory.unit);
  const [category, setCategory] = useState<string>(
    existing?.category ?? (habit ? 'habit' : defaultCategory.key),
  );
  const [unit, setUnit] = useState(initialUnit);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const existingDate = existing
    ? displayDate(existing.occurred_at, existing.timezone)
    : localDate(now);
  const existingTime = existing
    ? timeInZone(existing.occurred_at, existing.timezone)
    : localTime(now);
  const form = useForm<ActivityForm>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      title: existing?.title ?? habit?.name ?? '',
      category: (existing?.category ??
        (habit ? 'habit' : defaultCategory.key)) as ActivityForm['category'],
      amount: String(initialValue),
      unit: initialUnit,
      note: existing?.note ?? '',
      localDate: existingDate,
      localTime: existingTime,
      timezone: existing?.timezone ?? habit?.timezone ?? timezone,
    },
    mode: 'onBlur',
  });
  const watchedDate = form.watch('localDate');
  const watchedTime = form.watch('localTime');
  const habitForDate = useQuery({
    queryKey: ['habitForDate', habit?.id, watchedDate],
    queryFn: () => getHabitForDate(habit!.id, watchedDate),
    enabled: !!habit && !existing,
  });
  const activeHabit = habitForDate.data ?? habit;
  const selectedCategory = categories.find((item) => item.key === category) ?? categories[0]!;
  const measurement: MeasurementKind =
    existing?.measurement ??
    (activeHabit
      ? measurementForHabit(activeHabit.measurement, activeHabit.unit)
      : selectedCategory.measurement);
  const options = activeHabit
    ? unitsForMeasurement(measurement, activeHabit.configuredUnit)
    : unitsForMeasurement(measurement, selectedCategory.unit);
  const datePickerValue = useMemo(
    () => pickerDate(watchedDate, watchedTime),
    [watchedDate, watchedTime],
  );
  useEffect(() => {
    if (!visible) return;
    form.reset({
      title: existing?.title ?? habit?.name ?? '',
      category: (existing?.category ??
        (habit ? 'habit' : defaultCategory.key)) as ActivityForm['category'],
      amount: String(existing?.input_value ?? preset?.inputValue ?? ''),
      unit:
        existing?.input_unit ??
        preset?.inputUnit ??
        (habit?.configuredUnit || defaultCategory.unit),
      note: existing?.note ?? '',
      localDate: existing
        ? displayDate(existing.occurred_at, existing.timezone)
        : localDate(new Date()),
      localTime: existing
        ? timeInZone(existing.occurred_at, existing.timezone)
        : localTime(new Date()),
      timezone: existing?.timezone ?? habit?.timezone ?? timezone,
    });
    setCategory(existing?.category ?? (habit ? 'habit' : defaultCategory.key));
    setUnit(
      existing?.input_unit ?? preset?.inputUnit ?? habit?.configuredUnit ?? defaultCategory.unit,
    );
  }, [visible, existing?.id, preset?.id, habit?.id, form]);
  useEffect(() => {
    if (!visible || existing || !habitForDate.data) return;
    setUnit(habitForDate.data.configuredUnit);
    form.setValue('unit', habitForDate.data.configuredUnit, { shouldValidate: true });
  }, [visible, existing, habitForDate.data?.targetId, form]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <View className="max-h-[92%] rounded-t-3xl bg-canvas p-5">
          <Text className="mb-1 text-xl font-bold text-ink">
            {existing
              ? 'Edit activity'
              : preset
                ? `Log ${preset.name}`
                : habit
                  ? `Log ${habit.name}`
                  : 'Quick log'}
          </Text>
          <Text className="mb-4 text-sm text-slate-600">
            Activity time and recorded time are kept separately.
          </Text>
          {!habit ? (
            <>
              <Text className="mb-2 text-sm font-medium text-ink">Activity</Text>
              <View className="mb-4 flex-row flex-wrap gap-2">
                {categories.map((item) => (
                  <Pressable
                    key={item.key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: category === item.key }}
                    onPress={() => {
                      setCategory(item.key);
                      form.setValue('category', item.key as ActivityForm['category']);
                      const nextUnit = item.unit;
                      setUnit(nextUnit);
                      form.setValue('unit', nextUnit);
                    }}
                    className={`min-h-10 justify-center rounded-full border px-3 ${category === item.key ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'}`}
                  >
                    <Text className="text-sm text-ink">{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              {category === 'other' ? (
                <FormTextField
                  control={form.control}
                  name="title"
                  label="Activity name"
                  placeholder="What did you do?"
                  autoCapitalize="sentences"
                />
              ) : null}
            </>
          ) : null}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <FormTextField
                control={form.control}
                name="amount"
                label="Amount"
                placeholder="e.g. 500"
                keyboardType="decimal-pad"
              />
            </View>
            <View className="flex-1">
              <Text className="mb-2 text-sm font-medium text-ink">Unit</Text>
              <View className="flex-row flex-wrap gap-2">
                {options.map((choice) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: unit === choice }}
                    onPress={() => {
                      setUnit(choice);
                      form.setValue('unit', choice);
                    }}
                    className={`min-h-10 justify-center rounded-lg border px-3 ${unit === choice ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'}`}
                  >
                    <Text className="text-sm text-ink">{choice}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <FormTextField
            control={form.control}
            name="note"
            label="Note · optional"
            placeholder="Add a detail"
            autoCapitalize="sentences"
            multiline
            numberOfLines={2}
          />
          <Text className="mb-2 text-sm font-medium text-ink">When it happened</Text>
          <View className="mb-4 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowDate(true)}
              className="min-h-11 flex-1 justify-center rounded-xl border border-slate-300 bg-white px-3"
            >
              <Text className="text-sm text-ink">{watchedDate}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowTime(true)}
              className="min-h-11 w-24 justify-center rounded-xl border border-slate-300 bg-white px-3"
            >
              <Text className="text-sm text-ink">{watchedTime}</Text>
            </Pressable>
          </View>
          {showDate ? (
            <DateTimePicker
              value={datePickerValue}
              mode="date"
              display="default"
              onDismiss={() => setShowDate(false)}
              onValueChange={(_, date) => {
                form.setValue('localDate', localDate(date), {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                setShowDate(false);
              }}
            />
          ) : null}
          {showTime ? (
            <DateTimePicker
              value={datePickerValue}
              mode="time"
              display="default"
              onDismiss={() => setShowTime(false)}
              onValueChange={(_, date) => {
                form.setValue('localTime', localTime(date), {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                setShowTime(false);
              }}
            />
          ) : null}
          <View className="gap-3">
            <Button
              title={existing ? 'Save correction' : 'Save activity'}
              loading={form.formState.isSubmitting}
              onPress={form.handleSubmit(async (values) => {
                try {
                  const parsed = activityFormSchema.parse({ ...values, category });
                  const occurredAt = timestampFromLocal(
                    parsed.localDate,
                    parsed.localTime,
                    parsed.timezone,
                  );
                  await onSave(
                    {
                      idempotencyKey: existing?.idempotency_key ?? newActivityKey(),
                      habit,
                      category: habit ? 'habit' : parsed.category,
                      title:
                        habit?.name ??
                        (parsed.category === 'other' ? parsed.title : selectedCategory.label),
                      measurement,
                      kind: 'progress',
                      value: Number(parsed.amount),
                      unit,
                      note: parsed.note,
                      occurredAt,
                      timezone: parsed.timezone,
                      presetId: preset?.id ?? existing?.preset_id ?? null,
                      presetName: preset?.name ?? existing?.preset_name ?? null,
                    },
                    existing?.id,
                  );
                  form.reset();
                  onClose();
                } catch (error) {
                  form.setError('amount', {
                    type: 'server',
                    message:
                      error instanceof Error ? error.message : 'Could not save the activity.',
                  });
                }
              })}
            />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
            {existing && onDelete ? (
              <Button title="Remove activity" variant="quiet" onPress={onDelete} />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ActivityLogRow({
  entry,
  onPress,
  onRestore,
}: {
  entry: ActivityEntry;
  onPress?: () => void;
  onRestore?: () => void;
}) {
  const timestamp = new Date(entry.occurred_at);
  const title = entry.habit_name ?? (entry.title || entry.category);
  const displayAmount = entry.input_value ?? entry.value;
  const displayUnit = entry.input_unit ?? entry.unit;
  return (
    <View className="mb-2 rounded-xl border border-slate-200 bg-white p-3">
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={
          onPress
            ? `${title}, ${displayAmount ?? entry.kind} ${displayUnit ?? ''}, ${entry.local_date} ${timeInZone(entry.occurred_at, entry.timezone)}${entry.correction_count ? `, corrected ${entry.correction_count} times` : ''}`
            : undefined
        }
        disabled={!onPress}
        onPress={onPress}
      >
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 text-sm font-semibold text-ink">{title}</Text>
          <Text className="ml-2 text-xs text-slate-500">
            {timeInZone(timestamp.toISOString(), entry.timezone)}
          </Text>
        </View>
        <Text className="mt-1 text-sm text-slate-600">
          {displayAmount !== null
            ? `${displayAmount} ${displayUnit ?? ''}`
            : entry.kind.replaceAll('_', ' ')}
          {entry.note ? ` · ${entry.note}` : ''}
        </Text>
        <Text className="mt-1 text-[11px] text-slate-500">
          {entry.value_mode === 'daily_total'
            ? 'Self-reported daily total'
            : entry.source === 'manual'
              ? 'Manually recorded'
              : entry.source.replaceAll('_', ' ')}
        </Text>
        <Text className="mt-1 text-[11px] text-slate-500">
          Happened {entry.local_date} at {timeInZone(entry.occurred_at, entry.timezone)}
          {displayDate(entry.created_at, entry.timezone) !== entry.local_date ||
          timeInZone(entry.created_at, entry.timezone) !==
            timeInZone(entry.occurred_at, entry.timezone)
            ? ` · Recorded ${displayDate(entry.created_at, entry.timezone)} at ${timeInZone(entry.created_at, entry.timezone)}`
            : ''}
          {entry.correction_count ? ` · Corrected ${entry.correction_count} times` : ''}
        </Text>
      </Pressable>
      {onRestore ? (
        <View className="mt-2">
          <Button title="Restore entry" variant="secondary" fullWidth={false} onPress={onRestore} />
        </View>
      ) : null}
    </View>
  );
}
