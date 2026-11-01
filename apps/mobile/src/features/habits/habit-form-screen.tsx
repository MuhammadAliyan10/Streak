import DateTimePicker from '@react-native-community/datetimepicker';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Pressable, Text, View } from 'react-native';
import { useToast } from '../../components/feedback/toast-provider';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button } from '../../components/ui/button';
import { FormTextField } from '../../components/ui/form-text-field';
import { FormMessage } from '../../components/ui/form-message';
import { useAuth } from '../auth/auth-context';
import { getHabitBundle, saveHabit, type HabitRecord } from './habit-repository';
import { habitHref } from './habit-navigation';
import { dateAdd, habitSchema, todayInTimezone, type HabitInput } from './domain/habit-domain';
import { measurementForHabit, toCanonical } from './domain/activity-domain';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const icons = ['book', 'fitness', 'water', 'phone', 'money', 'sparkles'] as const;
const colors = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'] as const;
const initialValues = (): HabitInput => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    name: '',
    kind: 'good',
    description: '',
    icon: 'sparkles',
    color: 'indigo',
    measurement: 'check_off',
    digitalUsage: false,
    targetValue: '30',
    unit: 'minutes',
    scheduleMode: 'anytime',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    timezone,
    startDate: todayInTimezone(timezone),
    endDate: '',
    fixedTime: '09:00',
    windowStart: '07:00',
    windowEnd: '18:00',
  };
};
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`mr-2 mb-2 min-h-11 justify-center rounded-full border px-4 ${selected ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'}`}
    >
      <Text className={`font-medium ${selected ? 'text-primary' : 'text-slate-700'}`}>{label}</Text>
    </Pressable>
  );
}
function DateField({
  label,
  date,
  onPick,
  minimumDate,
}: {
  label: string;
  date: string;
  onPick: (value: string) => void;
  minimumDate?: Date;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="mb-4">
      <Text className="mb-2 text-sm font-medium text-ink">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${date || 'Not set'}`}
        onPress={() => setVisible(true)}
        className="min-h-12 justify-center rounded-xl border border-slate-300 bg-white px-4"
      >
        <Text className="text-base text-ink">{date || 'Not set'}</Text>
      </Pressable>
      {visible ? (
        <DateTimePicker
          mode="date"
          display="default"
          value={date ? new Date(`${date}T12:00:00`) : new Date()}
          {...(minimumDate ? { minimumDate } : {})}
          onDismiss={() => setVisible(false)}
          onValueChange={(_, value) => {
            onPick(
              `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`,
            );
            setVisible(false);
          }}
        />
      ) : null}
    </View>
  );
}
function TimeField({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const parsed = useMemo(() => {
    const [h, m] = value.split(':').map(Number);
    const date = new Date();
    date.setHours(h ?? 9, m ?? 0, 0, 0);
    return date;
  }, [value]);
  return (
    <View className="mb-4">
      <Text className="mb-2 text-sm font-medium text-ink">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        onPress={() => setVisible(true)}
        className="min-h-12 justify-center rounded-xl border border-slate-300 bg-white px-4"
      >
        <Text className="text-base text-ink">{value}</Text>
      </Pressable>
      {visible ? (
        <DateTimePicker
          mode="time"
          display="default"
          value={parsed}
          onDismiss={() => setVisible(false)}
          onValueChange={(_, date) => {
            onPick(
              `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
            );
            setVisible(false);
          }}
        />
      ) : null}
    </View>
  );
}

export function HabitFormScreen({ editing = false }: { editing?: boolean }) {
  const { status } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ habitId?: string }>();
  const id = editing ? params.habitId : undefined;
  const { showToast } = useToast();
  const client = useQueryClient();
  const form = useForm<HabitInput>({
    resolver: zodResolver(habitSchema),
    defaultValues: initialValues(),
    mode: 'onBlur',
  });
  const detail = useQuery({
    queryKey: ['habit', id],
    queryFn: () => getHabitBundle(id!),
    enabled: !!id,
  });
  useEffect(() => {
    if (!detail.data?.habit) return;
    const habit: HabitRecord = detail.data.habit;
    const source = habit as HabitRecord;
    form.reset({
      ...initialValues(),
      name: source.name,
      kind: source.kind,
      description: source.description,
      icon: source.icon as HabitInput['icon'],
      color: source.color as HabitInput['color'],
      measurement: source.measurement as HabitInput['measurement'],
      digitalUsage: source.digitalUsage,
      targetValue: String(source.targetValue),
      unit: source.unit,
      scheduleMode: source.scheduleMode,
      weekdays: days.map((_, day) => day).filter((day) => (source.weekdayMask & (1 << day)) !== 0),
      timezone: source.timezone,
      startDate: source.startDate,
      endDate: source.endDate ?? '',
      fixedTime: source.fixedTime ?? '09:00',
      windowStart: source.windowStart ?? '07:00',
      windowEnd: source.windowEnd ?? '18:00',
    });
  }, [detail.data, form]);
  const mutation = useMutation({
    mutationFn: async (values: HabitInput) => saveHabit(values, id),
    onSuccess: async (habitId) => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      showToast(editing ? 'Habit updated.' : 'Habit created.', 'success');
      router.replace(habitHref(`/habits/${habitId}`));
    },
    onError: () =>
      showToast('Could not save this habit. Your changes are still on this screen.', 'error'),
  });
  const submitForm = form.handleSubmit((values) => {
    const today = todayInTimezone(values.timezone);
    const effectiveFrom = id && values.startDate <= today ? dateAdd(today, 1) : values.startDate;
    if (values.endDate && values.endDate < effectiveFrom) {
      form.setError('endDate', {
        type: 'validate',
        message: `Choose an end date on or after ${effectiveFrom}.`,
      });
      return;
    }
    mutation.mutate(values);
  });
  if (status !== 'authenticated') return <Redirect href="/" />;
  const cancel = () =>
    form.formState.isDirty
      ? Alert.alert('Discard changes?', 'Your unsaved habit changes will be lost.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ])
      : router.back();
  const kind = form.watch('kind');
  const digitalUsage = form.watch('digitalUsage');
  const measurement = form.watch('measurement');
  const targetValue = form.watch('targetValue');
  const targetUnit = form.watch('unit');
  const highHydrationTarget = (() => {
    try {
      return (
        measurementForHabit(measurement, targetUnit) === 'volume' &&
        toCanonical(Number(targetValue), 'volume', targetUnit).value >= 5000
      );
    } catch {
      return false;
    }
  })();
  const mode = form.watch('scheduleMode');
  const selectedDays = form.watch('weekdays');
  const toggleDay = (day: number) =>
    form.setValue(
      'weekdays',
      selectedDays.includes(day)
        ? selectedDays.filter((value) => value !== day)
        : [...selectedDays, day].sort(),
      { shouldValidate: true, shouldDirty: true },
    );
  const patchInput = (name: keyof HabitInput, value: string) =>
    form.setValue(name as never, value as never, { shouldDirty: true, shouldValidate: true });
  const field = <N extends 'startDate' | 'endDate' | 'fixedTime' | 'windowStart' | 'windowEnd'>(
    name: N,
  ) => ({ value: form.watch(name), onPick: (value: string) => patchInput(name, value) });
  const minDate = new Date(`${form.watch('startDate')}T00:00:00`);
  return (
    <ScreenLayout
      header={{
        title: editing ? 'Edit habit' : 'New habit',
        subtitle: editing
          ? 'New settings start tomorrow to preserve history.'
          : 'Build a steady daily practice.',
      }}
    >
      <FormTextField
        control={form.control}
        name="name"
        label={digitalUsage ? 'App or behavior' : 'Habit name'}
        placeholder={digitalUsage ? 'e.g. Instagram or Reels' : 'e.g. Read every day'}
        autoCapitalize="sentences"
      />
      <FormTextField
        control={form.control}
        name="description"
        label="Description · optional"
        placeholder="Add a short note"
        autoCapitalize="sentences"
      />
      <Text className="mb-2 text-sm font-medium text-ink">Habit type</Text>
      <View className="mb-4 flex-row flex-wrap">
        <Choice
          label="Good habit"
          selected={kind === 'good' && !digitalUsage}
          onPress={() => {
            form.setValue('digitalUsage', false, { shouldDirty: true });
            form.setValue('kind', 'good', { shouldDirty: true });
            form.setValue('measurement', 'check_off', { shouldDirty: true });
          }}
        />
        <Choice
          label="Bad habit"
          selected={kind === 'bad' && !digitalUsage}
          onPress={() => {
            form.setValue('digitalUsage', false, { shouldDirty: true });
            form.setValue('kind', 'bad', { shouldDirty: true });
            form.setValue('measurement', 'avoidance', { shouldDirty: true });
          }}
        />
        <Choice
          label="Digital usage limit"
          selected={digitalUsage}
          onPress={() => {
            form.setValue('digitalUsage', true, { shouldDirty: true });
            form.setValue('kind', 'bad', { shouldDirty: true });
            form.setValue('measurement', 'duration', { shouldDirty: true });
            form.setValue('targetValue', '30', { shouldDirty: true });
            form.setValue('unit', 'min', { shouldDirty: true });
          }}
        />
      </View>
      <Text className="mb-2 text-sm font-medium text-ink">Icon</Text>
      <View className="mb-4 flex-row flex-wrap">
        {icons.map((icon) => (
          <Choice
            key={icon}
            label={icon[0]!.toUpperCase() + icon.slice(1)}
            selected={form.watch('icon') === icon}
            onPress={() => form.setValue('icon', icon, { shouldDirty: true })}
          />
        ))}
      </View>
      <Text className="mb-2 text-sm font-medium text-ink">Color</Text>
      <View className="mb-4 flex-row flex-wrap">
        {colors.map((color) => (
          <Choice
            key={color}
            label={color}
            selected={form.watch('color') === color}
            onPress={() => form.setValue('color', color, { shouldDirty: true })}
          />
        ))}
      </View>
      {kind === 'good' || digitalUsage ? (
        <>
          <Text className="mb-2 text-sm font-medium text-ink">
            {digitalUsage ? 'Daily maximum' : 'Target'}
          </Text>
          <View className="mb-2 flex-row flex-wrap">
            {(digitalUsage
              ? (['duration', 'count'] as const)
              : (['check_off', 'duration', 'count', 'quantity', 'distance'] as const)
            ).map((item) => (
              <Choice
                key={item}
                label={
                  {
                    check_off: 'Check off',
                    duration: 'Duration',
                    count: 'Count',
                    quantity: 'Quantity',
                    distance: 'Distance',
                  }[item]
                }
                selected={measurement === item}
                onPress={() => {
                  form.setValue('measurement', item, { shouldDirty: true });
                  form.setValue(
                    'unit',
                    {
                      duration: digitalUsage ? 'min' : 'minutes',
                      count: 'count',
                      quantity: 'ml',
                      distance: 'km',
                      check_off: 'times',
                    }[item],
                    { shouldDirty: true },
                  );
                }}
              />
            ))}
          </View>
          {measurement !== 'check_off' ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <FormTextField
                  control={form.control}
                  name="targetValue"
                  label={digitalUsage ? 'Daily limit' : 'Target amount'}
                  placeholder="30"
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-1">
                {measurement === 'duration' ||
                measurement === 'distance' ||
                measurement === 'count' ? (
                  <>
                    <Text className="mb-2 text-sm font-medium text-ink">Unit</Text>
                    <View className="flex-row flex-wrap">
                      {(measurement === 'duration'
                        ? ['sec', 'min', 'hr']
                        : measurement === 'distance'
                          ? ['m', 'km', 'mi']
                          : ['count', 'reps']
                      ).map((unit) => (
                        <Choice
                          key={unit}
                          label={unit}
                          selected={
                            form.watch('unit') === unit ||
                            (unit === 'min' && form.watch('unit') === 'minutes') ||
                            (unit === 'sec' && form.watch('unit') === 'seconds') ||
                            (unit === 'hr' && form.watch('unit') === 'hours')
                          }
                          onPress={() =>
                            form.setValue('unit', unit, { shouldDirty: true, shouldValidate: true })
                          }
                        />
                      ))}
                    </View>
                  </>
                ) : (
                  <FormTextField
                    control={form.control}
                    name="unit"
                    label="Unit"
                    placeholder="mL, pages, or custom unit"
                    autoCapitalize="none"
                  />
                )}
              </View>
            </View>
          ) : null}
          {digitalUsage ? (
            <FormMessage
              message="Values are manually recorded. Automatic app-usage access is unavailable in this build; Streak will not request device access."
              tone="info"
            />
          ) : null}
        </>
      ) : (
        <FormMessage
          message="Bad-habit streaks count only confirmed clean days. Record an occurrence when it happens."
          tone="info"
        />
      )}
      {kind === 'good' && highHydrationTarget ? (
        <FormMessage
          message="This is a high hydration target. Excessive water intake may be unsafe; choose a level that fits your needs."
          tone="info"
        />
      ) : null}
      <Text className="mb-2 text-sm font-medium text-ink">Schedule</Text>
      <View className="mb-2 flex-row flex-wrap">
        {(['anytime', 'fixed', 'flexible'] as const).map((item) => (
          <Choice
            key={item}
            label={{ anytime: 'Anytime', fixed: 'Fixed time', flexible: 'Flexible window' }[item]}
            selected={mode === item}
            onPress={() => form.setValue('scheduleMode', item, { shouldDirty: true })}
          />
        ))}
      </View>
      {mode === 'fixed' ? <TimeField label="Planned time" {...field('fixedTime')} /> : null}
      {mode === 'flexible' ? (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <TimeField label="Window starts" {...field('windowStart')} />
          </View>
          <View className="flex-1">
            <TimeField label="Window ends" {...field('windowEnd')} />
          </View>
        </View>
      ) : null}
      <Text className="mb-2 text-sm font-medium text-ink">Repeat on</Text>
      <View className="mb-2 flex-row flex-wrap">
        {days.map((day, index) => (
          <Choice
            key={day}
            label={day}
            selected={selectedDays.includes(index)}
            onPress={() => toggleDay(index)}
          />
        ))}
      </View>
      {form.formState.errors.weekdays?.message ? (
        <Text className="mb-3 text-sm text-red-700">{form.formState.errors.weekdays.message}</Text>
      ) : null}
      <Controller
        control={form.control}
        name="startDate"
        render={({ field: f, fieldState }) => (
          <>
            <DateField label="Starts" date={f.value} onPick={f.onChange} />
            {fieldState.error ? (
              <Text className="mb-2 text-sm text-red-700">{fieldState.error.message}</Text>
            ) : null}
          </>
        )}
      />
      <Controller
        control={form.control}
        name="endDate"
        render={({ field: f, fieldState }) => (
          <>
            <DateField
              label="Ends · optional"
              date={f.value}
              minimumDate={minDate}
              onPick={(value) => f.onChange(value)}
            />
            {f.value ? (
              <Button
                title="Clear end date"
                variant="quiet"
                size="regular"
                onPress={() => f.onChange('')}
              />
            ) : null}
            {fieldState.error ? (
              <Text className="mb-2 text-sm text-red-700">{fieldState.error.message}</Text>
            ) : null}
          </>
        )}
      />
      <FormMessage message={`Times and streak dates use ${form.watch('timezone')}.`} tone="info" />
      {Object.values(form.formState.errors).find((error) => error?.message)?.message ? (
        <Text accessibilityLiveRegion="polite" className="my-3 text-sm text-red-700">
          {String(Object.values(form.formState.errors).find((error) => error?.message)?.message)}
        </Text>
      ) : null}
      <View className="mt-4 gap-3">
        <Button
          title={editing ? 'Save changes' : 'Create habit'}
          loading={mutation.isPending}
          disabled={mutation.isPending}
          onPress={submitForm}
        />
        <Button title="Cancel" variant="secondary" onPress={cancel} />
      </View>
    </ScreenLayout>
  );
}
