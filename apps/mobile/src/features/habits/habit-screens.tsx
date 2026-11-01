import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { z } from 'zod';
import { useToast } from '../../components/feedback/toast-provider';
import { AppHeader } from '../../components/layout/app-header';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button, IconButton } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { FormTextField } from '../../components/ui/form-text-field';
import { useAuth } from '../auth/auth-context';
import { canAccessPrivateRoutes } from '../auth/auth-navigation';
import {
  addHabitEntry,
  createActivityLog,
  deleteActivityLog,
  getHabitPresets,
  getBuiltInDigitalPresets,
  getPresetsForHabits,
  getHabitBundle,
  listHabits,
  newActivityKey,
  restoreActivityLog,
  recordDigitalUsageTotal,
  updateActivityLog,
  setHabitStatus,
  type HabitRecord,
  type ActivityEntry,
  type ActivityPreset,
} from './habit-repository';
import { HabitNavigation, habitHref } from './habit-navigation';
import { measurementForHabit } from './domain/activity-domain';
import {
  enableAutomaticWalkingTracking,
  isWalkingDistanceHabit,
  setWalkingTrackingMode,
  syncWalkingSnapshot,
} from './walking-tracking';
import {
  ActivityLogRow,
  ActivityLogSheet,
  MeasurementProgress,
  PresetManagerSheet,
  QuickPresetButton,
} from './activity-components';

const progressSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount.')
    .refine((value) => Number(value) >= 0, 'Enter zero or a positive amount.'),
  note: z.string().max(280),
});
type ProgressForm = z.infer<typeof progressSchema>;
export function ProgressModal({
  habit,
  visible,
  onClose,
  onSave,
  mode = 'increment',
}: {
  habit: HabitRecord;
  visible: boolean;
  onClose: () => void;
  onSave: (value: number, note: string) => Promise<void> | void;
  mode?: 'increment' | 'daily_total';
}) {
  const form = useForm<ProgressForm>({
    resolver: zodResolver(progressSchema),
    defaultValues: { amount: '', note: '' },
  });
  useEffect(() => {
    if (visible) {
      form.reset({ amount: mode === 'daily_total' ? String(habit.progress) : '', note: '' });
    }
  }, [form, habit.id, habit.progress, mode, visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <View className="rounded-t-3xl bg-canvas p-6">
          <AppHeader
            title={
              mode === 'daily_total'
                ? "Set today's total"
                : habit.digitalUsage
                  ? 'Log usage'
                  : 'Log progress'
            }
            subtitle={
              mode === 'daily_total'
                ? `${habit.name} · maximum ${habit.targetValue} ${habit.unit}`
                : `${habit.name} · ${habit.digitalUsage ? 'manual entry' : `target ${habit.targetValue} ${habit.unit}`}`
            }
          />
          <FormTextField
            control={form.control}
            name="amount"
            label={`${mode === 'daily_total' ? 'Total for today' : 'Amount'} (${habit.unit})`}
            placeholder="e.g. 20"
            keyboardType="decimal-pad"
          />
          <FormTextField
            control={form.control}
            name="note"
            label="Note · optional"
            placeholder="What did you do?"
            autoCapitalize="sentences"
          />
          <View className="gap-3">
            <Button
              title={
                mode === 'daily_total'
                  ? 'Confirm daily total'
                  : habit.digitalUsage
                    ? 'Log usage'
                    : measurementForHabit(habit.measurement, habit.unit) === 'distance'
                      ? 'Save distance'
                      : 'Save progress'
              }
              loading={form.formState.isSubmitting}
              disabled={form.formState.isSubmitting}
              onPress={form.handleSubmit(async ({ amount, note }) => {
                if (mode === 'increment' && Number(amount) <= 0) {
                  form.setError('amount', {
                    type: 'validate',
                    message: 'Amount must be greater than zero.',
                  });
                  return;
                }
                try {
                  await onSave(Number(amount), note);
                  form.reset();
                  onClose();
                } catch {
                  form.setError('amount', {
                    type: 'server',
                    message: 'Could not save progress. Try again.',
                  });
                }
              })}
            />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
export function HabitCard({
  habit,
  onOpen,
  onQuick,
  onProgress,
  onDailyTotal,
  loading,
  actionEnabled = true,
  presets = [],
  onPreset,
  onManagePresets,
  onOccurrence,
  recentActivity,
}: {
  habit: HabitRecord;
  onOpen: () => void;
  onQuick: () => void;
  onProgress: () => void;
  onDailyTotal?: () => void;
  loading: boolean;
  actionEnabled?: boolean;
  presets?: ActivityPreset[];
  onPreset?: (preset: ActivityPreset) => void;
  onManagePresets?: () => void;
  onOccurrence?: () => void;
  recentActivity?: string | undefined;
}) {
  const measurementIcon =
    habit.kind === 'bad'
      ? '↘'
      : (
          {
            volume: '💧',
            duration: '◷',
            distance: '↗',
            count: '✕',
            pages: '▤',
            quantity: '＋',
          } as const
        )[measurementForHabit(habit.measurement, habit.unit)];
  const done = habit.digitalUsage
    ? false
    : habit.todayState === 'completed' || habit.todayState === 'clean';
  const amount = habit.digitalUsage
    ? habit.usageStatus === 'unknown'
      ? 'No usage data yet'
      : `${habit.progress} ${habit.unit} ${habit.usageStatus === 'within_limit' ? '· confirmed within limit' : habit.usageStatus === 'over_limit' ? '· over limit' : '· so far'}`
    : habit.measurement === 'check_off' || habit.kind === 'bad'
      ? habit.kind === 'bad' && habit.todayState === 'incident'
        ? 'Occurrence recorded'
        : done
          ? 'Checked in today'
          : habit.kind === 'bad'
            ? 'No check-in yet'
            : 'Not done yet'
      : `${habit.progress} of ${habit.targetValue} ${habit.unit}`;
  const quickLabel = habit.digitalUsage
    ? habit.usageStatus === 'within_limit' || habit.usageStatus === 'over_limit'
      ? 'Update daily total'
      : 'Log usage'
    : habit.kind === 'bad'
      ? 'Clean day'
      : habit.measurement === 'check_off'
        ? 'Complete'
        : measurementForHabit(habit.measurement, habit.unit) === 'distance'
          ? 'Add distance'
          : 'Log progress';
  return (
    <View
      className={`mb-4 rounded-2xl border bg-white p-4 ${habit.kind === 'bad' ? 'border-rose-200' : 'border-slate-200'}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${habit.name}`}
        onPress={onOpen}
        className="flex-row items-start justify-between"
      >
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="mr-2 text-lg">{measurementIcon}</Text>
            <Text className="text-base font-semibold text-ink">{habit.name}</Text>
          </View>
          <Text className="mt-1 text-sm text-slate-600">
            {habit.kind === 'good' ? 'Good habit' : 'Avoidance habit'} · {amount}
          </Text>
          {habit.trackingMode === 'automatic' ? (
            <Text className="mt-1 text-xs text-indigo-700">
              {habit.deviceSnapshotRefreshedAt
                ? `Device distance synced ${new Date(habit.deviceSnapshotRefreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'No confirmed device total today · manual progress shown'}
            </Text>
          ) : null}
        </View>
        <Text className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-primary">
          🔥 {habit.streak.current}
        </Text>
      </Pressable>
      {habit.digitalUsage || (habit.kind === 'good' && habit.measurement !== 'check_off') ? (
        <MeasurementProgress habit={habit} />
      ) : null}
      {actionEnabled &&
      (habit.digitalUsage || (habit.kind === 'good' && habit.measurement !== 'check_off')) &&
      !(habit.digitalUsage && habit.usageConfirmed) ? (
        <View className="mt-3">
          <View className="flex-row flex-wrap">
            {presets.slice(0, 3).map((preset) => (
              <QuickPresetButton
                key={preset.id}
                habit={habit}
                preset={preset}
                loading={loading}
                onPress={() => onPreset?.(preset)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${presets.length > 3 ? 'More quick actions' : 'Manage quick actions'} for ${habit.name}`}
              onPress={onManagePresets}
              className="min-h-12 justify-center px-2"
            >
              <Text className="text-sm font-medium text-primary">
                {presets.length ? 'More' : '+ Quick action'}
              </Text>
            </Pressable>
          </View>
          {habit.digitalUsage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Set confirmed daily usage total for ${habit.name}`}
              onPress={onDailyTotal}
              className="min-h-11 justify-center px-2"
            >
              <Text className="text-sm font-medium text-primary">
                {habit.usageConfirmed ? "Update today's total" : "Set today's total"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {recentActivity ? (
        <Text className="mt-2 text-xs text-slate-500">Recent · {recentActivity}</Text>
      ) : null}
      <View className="mt-4 flex-row items-center justify-between">
        <Text className="text-xs text-slate-500">
          {habit.status === 'paused' ? 'Paused' : `${habit.streak.longest} longest streak`}
        </Text>
        {actionEnabled ? (
          <Button
            title={quickLabel}
            size="regular"
            fullWidth={false}
            disabled={
              habit.status !== 'active' ||
              (done && !habit.digitalUsage) ||
              (habit.kind === 'bad' && habit.todayState === 'incident') ||
              loading
            }
            loading={loading}
            onPress={
              habit.digitalUsage && habit.usageConfirmed
                ? (onDailyTotal ?? onProgress)
                : habit.digitalUsage || (habit.kind === 'good' && habit.measurement !== 'check_off')
                  ? onProgress
                  : onQuick
            }
          />
        ) : (
          <Text className="text-xs capitalize text-slate-500">{habit.todayState}</Text>
        )}
      </View>
      {actionEnabled && habit.kind === 'bad' && !habit.digitalUsage ? (
        <View className="mt-2">
          <Button
            title="Record occurrence"
            variant="secondary"
            disabled={habit.status !== 'active' || loading}
            loading={loading}
            onPress={onOccurrence ?? onQuick}
          />
        </View>
      ) : null}
    </View>
  );
}
export function HabitsScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const [filter, setFilter] = useState<'all' | 'good' | 'bad'>('all');
  const [selected, setSelected] = useState<HabitRecord | null>(null);
  const [presetHabit, setPresetHabit] = useState<HabitRecord | null>(null);
  const habits = useQuery({ queryKey: ['habits', filter], queryFn: () => listHabits(filter) });
  const presets = useQuery({
    queryKey: ['activityPresets', (habits.data ?? []).map((habit) => habit.id).join(',')],
    queryFn: () => getPresetsForHabits((habits.data ?? []).map((habit) => habit.id)),
    enabled: !!habits.data?.length,
  });
  const save = useMutation({
    mutationFn: ({
      habit,
      kind,
      value,
      note,
    }: {
      habit: HabitRecord;
      kind: 'progress' | 'complete_override' | 'occurrence' | 'clean' | 'skip';
      value?: number;
      note?: string;
    }) => addHabitEntry(habit, kind, value ?? null, note),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Check-in saved.', 'success');
    },
    onError: () => showToast('Could not record this check-in. Try again.', 'error'),
  });
  const logPreset = useMutation({
    mutationFn: ({ habit, preset }: { habit: HabitRecord; preset: ActivityPreset }) =>
      createActivityLog({
        idempotencyKey: newActivityKey(),
        habit,
        category: 'habit',
        title: habit.name,
        measurement: preset.measurement,
        value: preset.inputValue,
        unit: preset.inputUnit,
        occurredAt: new Date().toISOString(),
        timezone: habit.timezone,
        presetId: preset.id.startsWith('digital-quick:') ? null : preset.id,
        presetName: preset.name,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Activity logged.', 'success');
    },
    onError: () => showToast('Could not log this activity. Try again.', 'error'),
  });
  if (!canAccessPrivateRoutes(status)) return <Redirect href="/" />;
  const items = habits.data ?? [];
  return (
    <ScreenLayout
      bottomNavigation={<HabitNavigation selected="habits" />}
      header={{
        title: 'Habits',
        subtitle: 'Small actions, steady progress.',
        action: (
          <IconButton
            accessibilityLabel="Add a habit"
            icon={<Text className="text-2xl text-primary">＋</Text>}
            onPress={() => router.push(habitHref('/habits/new'))}
          />
        ),
      }}
    >
      <View className="mb-4 flex-row">
        {(['all', 'good', 'bad'] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === item }}
            onPress={() => setFilter(item)}
            className={`mr-2 rounded-full px-4 py-2 ${filter === item ? 'bg-indigo-100' : 'bg-white'}`}
          >
            <Text
              className={`font-medium capitalize ${filter === item ? 'text-primary' : 'text-slate-600'}`}
            >
              {item === 'all' ? 'All habits' : `${item} habits`}
            </Text>
          </Pressable>
        ))}
      </View>
      {habits.isLoading ? (
        <Text className="py-10 text-center text-slate-600">Loading your habits…</Text>
      ) : habits.isError ? (
        <ErrorState
          message="Your saved habits could not be loaded."
          onRetry={() => void habits.refetch()}
        />
      ) : items.length ? (
        items.map((habit) => (
          <HabitCard
            key={habit.id}
            habit={habit}
            onOpen={() => router.push(habitHref(`/habits/${habit.id}`))}
            onQuick={() => {
              const kind = habit.kind === 'bad' ? 'clean' : 'complete_override';
              save.mutate({ habit, kind });
            }}
            onOccurrence={() => save.mutate({ habit, kind: 'occurrence' })}
            onProgress={() => setSelected(habit)}
            presets={(presets.data ?? []).filter(
              (preset) =>
                preset.habitId === habit.id &&
                preset.measurement === measurementForHabit(habit.measurement, habit.unit),
            )}
            onPreset={(preset) => logPreset.mutate({ habit, preset })}
            onManagePresets={() => setPresetHabit(habit)}
            loading={save.isPending || logPreset.isPending}
          />
        ))
      ) : (
        <>
          <EmptyState
            title="Start with one habit"
            message={
              filter === 'all'
                ? 'Create a good habit to build or a bad habit you want to avoid.'
                : `No ${filter} habits yet. Create one to get started.`
            }
          />
          <View className="mt-4">
            <Button title="Create a habit" onPress={() => router.push(habitHref('/habits/new'))} />
          </View>
        </>
      )}
      {selected ? (
        <ActivityLogSheet
          visible
          habit={selected}
          onClose={() => setSelected(null)}
          onSave={async (input) => {
            await createActivityLog(input);
            await client.invalidateQueries({ queryKey: ['habits'] });
            await client.invalidateQueries({ queryKey: ['planner'] });
            showToast('Activity logged.', 'success');
          }}
        />
      ) : null}
      {presetHabit ? (
        <PresetManagerSheet
          visible
          habit={presetHabit}
          presets={(presets.data ?? []).filter((preset) => preset.habitId === presetHabit.id)}
          onClose={() => setPresetHabit(null)}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: ['activityPresets'] });
            showToast('Quick actions updated.', 'success');
          }}
        />
      ) : null}
    </ScreenLayout>
  );
}

function DayPills({ days }: { days: Array<{ date: string; state: string }> }) {
  return (
    <View className="mb-4 flex-row flex-wrap">
      {days.slice(-35).map((day) => {
        const success = ['completed', 'clean'].includes(day.state);
        const color =
          day.state === 'completed' || day.state === 'clean'
            ? 'bg-emerald-500'
            : day.state === 'incident'
              ? 'bg-rose-700'
              : day.state === 'missed'
                ? 'bg-rose-400'
                : day.state === 'skipped'
                  ? 'bg-slate-400'
                  : day.state === 'paused'
                    ? 'bg-slate-300'
                    : day.state === 'partial'
                      ? 'bg-amber-400'
                      : day.state === 'pending'
                        ? 'bg-sky-100'
                        : day.state === 'unknown'
                          ? 'border border-slate-200 bg-white'
                          : 'bg-transparent';
        return (
          <View
            key={day.date}
            accessible
            accessibilityLabel={`${day.date}: ${day.state}`}
            className={`mb-2 mr-2 h-7 w-7 items-center justify-center rounded-md ${color}`}
          >
            <Text
              className={`text-[9px] ${success || ['missed', 'incident', 'skipped'].includes(day.state) ? 'text-white' : 'text-slate-500'}`}
            >
              {Number(day.date.slice(-2))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
export function HabitDetailScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const { habitId = '' } = useLocalSearchParams<{ habitId: string }>();
  const client = useQueryClient();
  const { showToast } = useToast();
  const [progressOpen, setProgressOpen] = useState(false);
  const [dailyTotalOpen, setDailyTotalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const query = useQuery({
    queryKey: ['habit', habitId],
    queryFn: async () => {
      const bundle = await getHabitBundle(habitId, true);
      if (
        bundle?.habit.trackingMode === 'automatic' &&
        isWalkingDistanceHabit(bundle.habit.name, bundle.habit.measurement)
      ) {
        await syncWalkingSnapshot(bundle.habit.id, bundle.habit.timezone).catch(() => undefined);
        return getHabitBundle(habitId, true);
      }
      return bundle;
    },
  });
  const bundle = query.data;
  const habit = bundle?.habit;
  const presets = useQuery({
    queryKey: ['activityPresets', habitId],
    queryFn: () => getHabitPresets(habitId),
    enabled: !!habitId,
  });
  const statusMutation = useMutation({
    mutationFn: (next: 'active' | 'paused' | 'archived') => setHabitStatus(habitId, next),
    onSuccess: async (_, next) => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      showToast(
        next === 'archived'
          ? 'Habit archived.'
          : next === 'paused'
            ? 'Habit paused.'
            : 'Habit resumed.',
        'success',
      );
      if (next === 'archived') router.replace(habitHref('/habits'));
    },
    onError: () => showToast('Could not update this habit.', 'error'),
  });
  const trackingMutation = useMutation({
    mutationFn: async (mode: 'manual' | 'automatic') => {
      if (mode === 'automatic') {
        const permission = await enableAutomaticWalkingTracking();
        if (permission === 'unavailable') throw new Error('unavailable');
        if (permission === 'denied') throw new Error('denied');
      }
      await setWalkingTrackingMode(habitId, mode);
      if (mode === 'automatic' && habit) {
        await syncWalkingSnapshot(habitId, habit.timezone).catch(() => undefined);
      }
      return mode;
    },
    onSuccess: async (mode) => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      showToast(
        mode === 'automatic' ? 'Automatic walking distance enabled.' : 'Manual tracking enabled.',
        'success',
      );
    },
    onError: (error) => {
      showToast(
        error instanceof Error && error.message === 'unavailable'
          ? 'Health data is unavailable on this device. Manual tracking is still available.'
          : error instanceof Error && error.message === 'denied'
            ? 'Health access was not granted. Manual tracking is still available.'
            : 'Could not update walking tracking.',
        'error',
      );
    },
  });
  const digitalTotalMutation = useMutation({
    mutationFn: (value: number) => recordDigitalUsageTotal(habit!, value),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      showToast('Daily usage total confirmed.', 'success');
    },
    onError: () => showToast('Could not save the daily usage total.', 'error'),
  });
  const entryMutation = useMutation({
    mutationFn: ({
      kind,
      value,
      note,
    }: {
      kind: 'progress' | 'complete_override' | 'occurrence' | 'clean' | 'skip';
      value?: number;
      note?: string;
    }) => addHabitEntry(habit!, kind, value ?? null, note),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
      showToast('Check-in saved.', 'success');
    },
    onError: () => showToast('Could not record this check-in. Try again.', 'error'),
  });
  const presetMutation = useMutation({
    mutationFn: (preset: ActivityPreset) =>
      createActivityLog({
        idempotencyKey: newActivityKey(),
        habit: habit!,
        category: 'habit',
        title: habit!.name,
        measurement: preset.measurement,
        value: preset.inputValue,
        unit: preset.inputUnit,
        occurredAt: new Date().toISOString(),
        timezone: habit!.timezone,
        presetId: preset.id.startsWith('digital-quick:') ? null : preset.id,
        presetName: preset.name,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
      showToast('Activity logged.', 'success');
    },
    onError: () => showToast('Could not log this activity. Try again.', 'error'),
  });
  const editLogMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateActivityLog>[1] }) =>
      updateActivityLog(id, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
      showToast('Activity corrected.', 'success');
    },
    onError: () => showToast('Could not correct this activity. Try again.', 'error'),
  });
  const deleteLogMutation = useMutation({
    mutationFn: deleteActivityLog,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
      showToast('Activity moved to removed entries.', 'success');
    },
    onError: () => showToast('Could not remove this activity.', 'error'),
  });
  const restoreLogMutation = useMutation({
    mutationFn: restoreActivityLog,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['habit', habitId] });
      await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
      showToast('Activity restored.', 'success');
    },
    onError: () => showToast('Could not restore this activity.', 'error'),
  });
  if (!canAccessPrivateRoutes(status)) return <Redirect href="/" />;
  if (query.isLoading)
    return (
      <ScreenLayout>
        <Text className="py-12 text-center text-slate-600">Loading habit…</Text>
      </ScreenLayout>
    );
  if (query.isError)
    return (
      <ScreenLayout>
        <ErrorState message="Could not load this habit." onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  if (!habit || !bundle)
    return (
      <ScreenLayout>
        <EmptyState title="Habit unavailable" message="It may have been archived." />
        <Button title="Back to habits" onPress={() => router.replace(habitHref('/habits'))} />
      </ScreenLayout>
    );
  const isDone =
    !habit.digitalUsage && (habit.todayState === 'completed' || habit.todayState === 'clean');
  const walkingEligible =
    habit.kind === 'good' && isWalkingDistanceHabit(habit.name, habit.measurement);
  const matchingPresets = (presets.data ?? []).filter(
    (preset) => preset.measurement === measurementForHabit(habit.measurement, habit.unit),
  );
  const quickPresets = matchingPresets.length ? matchingPresets : getBuiltInDigitalPresets(habit);
  const confirmStatus = (next: 'active' | 'paused' | 'archived') =>
    Alert.alert(
      next === 'archived' ? 'Archive habit?' : next === 'paused' ? 'Pause habit?' : 'Resume habit?',
      next === 'archived'
        ? 'This keeps its history and removes it from your active list.'
        : next === 'paused'
          ? 'Paused days will be excluded from streaks.'
          : 'This habit will be active again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'archived' ? 'Archive' : next === 'paused' ? 'Pause' : 'Resume',
          style: next === 'archived' ? 'destructive' : 'default',
          onPress: () => statusMutation.mutate(next),
        },
      ],
    );
  const record = (kind: 'complete_override' | 'clean' | 'occurrence' | 'skip') =>
    entryMutation.mutate({ kind });
  return (
    <ScreenLayout
      bottomNavigation={<HabitNavigation selected="habits" />}
      header={{
        title: habit.name,
        subtitle: `${habit.kind === 'good' ? 'Good habit' : 'Avoidance habit'} · ${habit.status}`,
      }}
    >
      <View className="mb-5 rounded-2xl bg-indigo-50 p-5">
        <Text className="text-sm font-semibold uppercase tracking-wide text-primary">
          Current streak
        </Text>
        <Text className="mt-2 text-4xl font-bold text-ink">
          {habit.streak.current} <Text className="text-xl">days</Text>
        </Text>
        <Text className="mt-2 text-sm text-slate-600">
          Longest {habit.streak.longest} · {habit.streak.completionPercent}% confirmed completion
        </Text>
      </View>
      <Text className="mb-2 text-base font-semibold text-ink">Today</Text>
      <Text className="mb-2 text-sm text-slate-600">
        {habit.digitalUsage
          ? habit.usageStatus === 'unknown'
            ? 'No usage data yet · daily total not confirmed'
            : `${habit.progress} ${habit.unit} ${habit.usageStatus === 'within_limit' ? 'confirmed within limit' : habit.usageStatus === 'over_limit' ? 'over the daily limit' : 'logged so far'}`
          : habit.kind === 'bad'
            ? habit.todayState === 'unknown' || habit.todayState === 'pending'
              ? 'No check-in recorded yet'
              : habit.todayState
            : habit.measurement === 'check_off'
              ? habit.todayState
              : `${habit.progress} / ${habit.targetValue} ${habit.unit} · ${Math.min(100, Math.round((habit.progress / habit.targetValue) * 100))}%`}
      </Text>
      {(habit.digitalUsage && !habit.usageConfirmed) ||
      (habit.kind === 'good' && habit.measurement !== 'check_off') ? (
        <MeasurementProgress habit={habit} />
      ) : null}
      {habit.digitalUsage || (habit.kind === 'good' && habit.measurement !== 'check_off') ? (
        <View className="mb-3 mt-3">
          <View className="flex-row flex-wrap">
            {quickPresets.slice(0, 3).map((preset) => (
              <QuickPresetButton
                key={preset.id}
                habit={habit}
                preset={preset}
                loading={presetMutation.isPending}
                onPress={() => presetMutation.mutate(preset)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPresetManagerOpen(true)}
              className="min-h-12 justify-center px-2"
            >
              <Text className="text-sm font-semibold text-primary">
                {presets.data?.length
                  ? 'Manage'
                  : habit.digitalUsage
                    ? 'Edit presets'
                    : '+ Quick action'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {habit.kind === 'good' &&
      measurementForHabit(habit.measurement, habit.unit) === 'duration' &&
      habit.status === 'active' ? (
        <View className="mb-4">
          <Button
            title="Start timer"
            variant="secondary"
            onPress={() =>
              router.push(
                habitHref(
                  `/focus/setup?habitId=${encodeURIComponent(habit.id)}&title=${encodeURIComponent(habit.name)}`,
                ),
              )
            }
          />
        </View>
      ) : null}
      {habit.kind === 'good' && habit.measurement !== 'check_off' ? (
        <View className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <View
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, (habit.progress / habit.targetValue) * 100)}%` }}
          />
        </View>
      ) : null}
      <Text className="mb-2 mt-3 text-base font-semibold text-ink">Schedule & target</Text>
      <Text className="mb-1 text-sm text-slate-600">
        {habit.scheduleMode === 'fixed'
          ? `Planned at ${habit.fixedTime}`
          : habit.scheduleMode === 'flexible'
            ? `${habit.windowStart}–${habit.windowEnd}`
            : 'Anytime'}{' '}
        · {daysLabel(habit.weekdayMask)}
      </Text>
      <Text className="mb-5 text-sm text-slate-600">
        {habit.digitalUsage
          ? `${habit.targetValue} ${habit.unit} maximum per scheduled day`
          : habit.kind === 'bad'
            ? 'Avoid the behavior'
            : `${habit.measurement === 'check_off' ? 'Check off' : `${habit.targetValue} ${habit.unit}`} per scheduled day`}
      </Text>
      {walkingEligible ? (
        <View className="mb-5 rounded-2xl border border-slate-200 p-4">
          <Text className="text-base font-semibold text-ink">Walking tracking</Text>
          <Text className="mb-3 mt-1 text-sm text-slate-600">
            {habit.trackingMode === 'automatic'
              ? 'Device totals replace manual totals for any day with a device reading. Manual entries stay in history; manual progress is used when no device total is available.'
              : 'Choose automatic device distance or keep entering distance manually.'}
          </Text>
          {habit.trackingMode === 'automatic' ? (
            <Button
              title="Use manual tracking"
              variant="secondary"
              loading={trackingMutation.isPending}
              disabled={trackingMutation.isPending}
              onPress={() => trackingMutation.mutate('manual')}
            />
          ) : (
            <Button
              title="Enable automatic distance"
              variant="secondary"
              loading={trackingMutation.isPending}
              disabled={trackingMutation.isPending}
              onPress={() => trackingMutation.mutate('automatic')}
            />
          )}
        </View>
      ) : null}
      {habit.kind === 'bad' && !habit.digitalUsage ? (
        <Text className="mb-5 text-sm text-slate-600">
          {habit.occurrenceCount} occurrence{habit.occurrenceCount === 1 ? '' : 's'} across{' '}
          {habit.incidentDays} day{habit.incidentDays === 1 ? '' : 's'}
        </Text>
      ) : null}
      <Text className="mb-2 text-base font-semibold text-ink">Recent history</Text>
      <DayPills days={habit.streak.days} />
      <View className="mb-4 flex-row flex-wrap gap-2">
        <Text className="text-xs text-slate-500">● Done / clean</Text>
        <Text className="text-xs text-slate-500">● Partial</Text>
        <Text className="text-xs text-slate-500">● Missed</Text>
        <Text className="text-xs text-slate-500">● Incident</Text>
        <Text className="text-xs text-slate-500">● Skipped</Text>
        <Text className="text-xs text-slate-500">● Unknown / pending</Text>
      </View>
      {habit.digitalUsage ? (
        <View className="mb-3 gap-3">
          {!habit.usageConfirmed ? (
            <Button
              title="Log usage"
              disabled={habit.status !== 'active'}
              onPress={() => setProgressOpen(true)}
            />
          ) : null}
          <Button
            title={habit.usageConfirmed ? "Update today's total" : "Set today's total"}
            variant="secondary"
            disabled={habit.status !== 'active'}
            onPress={() => setDailyTotalOpen(true)}
          />
        </View>
      ) : habit.kind === 'good' ? (
        <View className="mb-3 gap-3">
          <Button
            title={
              habit.measurement === 'check_off'
                ? 'Mark complete'
                : measurementForHabit(habit.measurement, habit.unit) === 'distance'
                  ? 'Add distance'
                  : 'Log progress'
            }
            disabled={isDone || habit.status !== 'active'}
            onPress={() =>
              habit.measurement === 'check_off'
                ? record('complete_override')
                : setProgressOpen(true)
            }
          />
          {habit.measurement !== 'check_off' && !isDone ? (
            <Button
              title="Mark complete anyway"
              variant="secondary"
              disabled={habit.status !== 'active'}
              onPress={() =>
                Alert.alert('Complete this habit?', 'This records a manual completion for today.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Mark complete', onPress: () => record('complete_override') },
                ])
              }
            />
          ) : null}
        </View>
      ) : (
        <View className="mb-3 gap-3">
          <Button
            title="Mark clean today"
            variant="secondary"
            disabled={isDone || habit.todayState === 'incident' || habit.status !== 'active'}
            onPress={() => record('clean')}
          />
          <Button
            title="Record an occurrence"
            variant="secondary"
            disabled={habit.status !== 'active'}
            onPress={() => record('occurrence')}
          />
        </View>
      )}
      {habit.todayState !== 'skipped' && habit.status === 'active' ? (
        <View className="mb-3">
          <Button
            title="Skip today"
            variant="quiet"
            onPress={() =>
              Alert.alert(
                'Skip today?',
                'This scheduled day will be marked skipped and excluded from confirmed completions.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Skip today', onPress: () => record('skip') },
                ],
              )
            }
          />
        </View>
      ) : null}
      {habit.status !== 'archived' ? (
        <>
          <View className="mb-3">
            <Button
              title="Edit habit"
              variant="secondary"
              onPress={() => router.push(habitHref(`/habits/${habit.id}/edit`))}
            />
          </View>
          <View className="mb-3">
            <Button
              title={habit.status === 'paused' ? 'Resume habit' : 'Pause habit'}
              variant="secondary"
              loading={statusMutation.isPending}
              onPress={() => confirmStatus(habit.status === 'paused' ? 'active' : 'paused')}
            />
          </View>
          <Button title="Archive habit" variant="quiet" onPress={() => confirmStatus('archived')} />
          <View className="mt-2">
            <Button
              title="Delete habit"
              variant="quiet"
              onPress={() =>
                Alert.alert(
                  'Delete habit?',
                  'This removes it from your active list and keeps its history. You can restore it from History.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => statusMutation.mutate('archived'),
                    },
                  ],
                )
              }
            />
          </View>
        </>
      ) : (
        <Button
          title="Restore habit"
          variant="secondary"
          loading={statusMutation.isPending}
          onPress={() => confirmStatus('active')}
        />
      )}
      <View className="mb-3 mt-6 flex-row items-center justify-between">
        <Text className="text-base font-semibold text-ink">Recent activity</Text>
        <Button
          title="View all"
          variant="quiet"
          fullWidth={false}
          onPress={() => router.push(habitHref(`/habits/${habit.id}/logs`))}
        />
      </View>
      {bundle.entries
        .filter((entry) => !entry.deleted_at)
        .slice(0, 50)
        .map((entry) => (
          <ActivityLogRow
            key={entry.id}
            entry={entry}
            onPress={() =>
              entry.value_mode === 'daily_total'
                ? Alert.alert('Daily usage total', `${entry.note} · ${entry.local_date}`)
                : entry.focus_session_id
                  ? router.push(
                      habitHref(
                        `/focus/session?sessionId=${encodeURIComponent(entry.focus_session_id)}`,
                      ),
                    )
                  : entry.kind === 'progress'
                    ? setSelectedEntry(entry)
                    : Alert.alert(
                        entry.title || habit.name,
                        `${entry.kind.replaceAll('_', ' ')} · ${entry.local_date} ${entry.occurred_at.slice(11, 16)}`,
                        [
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => deleteLogMutation.mutate(entry.id),
                          },
                          { text: 'Close', style: 'cancel' },
                        ],
                      )
            }
          />
        ))}
      {bundle.entries.some((entry) => entry.deleted_at) ? (
        <>
          <Text className="mb-2 mt-4 text-base font-semibold text-ink">Removed entries</Text>
          {bundle.entries
            .filter((entry) => entry.deleted_at)
            .slice(0, 10)
            .map((entry) => (
              <ActivityLogRow
                key={entry.id}
                entry={entry}
                onRestore={() =>
                  entry.focus_session_id
                    ? router.push(
                        habitHref(
                          `/focus/session?sessionId=${encodeURIComponent(entry.focus_session_id)}`,
                        ),
                      )
                    : restoreLogMutation.mutate(entry.id)
                }
              />
            ))}
        </>
      ) : null}
      <Text className="mb-2 mt-4 text-base font-semibold text-ink">Changes</Text>
      {bundle.history.slice(0, 8).map((event, index) => (
        <Text
          key={`${event.occurred_at}-${index}`}
          className="mb-2 text-sm capitalize text-slate-600"
        >
          {event.local_date} · {event.event_type.replace('_', ' ')}
        </Text>
      ))}
      <ActivityLogSheet
        visible={progressOpen || !!selectedEntry}
        habit={habit}
        {...(selectedEntry ? { existing: selectedEntry } : {})}
        onClose={() => {
          setProgressOpen(false);
          setSelectedEntry(null);
        }}
        onSave={async (input, id) => {
          if (id) await editLogMutation.mutateAsync({ id, input });
          else await createActivityLog(input);
          await client.invalidateQueries({ queryKey: ['habits'] });
          await client.invalidateQueries({ queryKey: ['planner'] });
          await client.invalidateQueries({ queryKey: ['habit', habitId] });
          await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
          if (!id) showToast('Activity logged.', 'success');
        }}
        onDelete={() => {
          if (!selectedEntry) return;
          Alert.alert(
            'Remove this activity?',
            'It will disappear from totals and the timeline. You can restore it from Removed entries.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => {
                  deleteLogMutation.mutate(selectedEntry.id);
                  setSelectedEntry(null);
                  setProgressOpen(false);
                },
              },
            ],
          );
        }}
      />
      {habit.digitalUsage ? (
        <ProgressModal
          visible={dailyTotalOpen}
          habit={habit}
          mode="daily_total"
          onClose={() => setDailyTotalOpen(false)}
          onSave={(value) => digitalTotalMutation.mutateAsync(value)}
        />
      ) : null}
      <PresetManagerSheet
        visible={presetManagerOpen}
        habit={habit}
        presets={presets.data ?? []}
        onClose={() => setPresetManagerOpen(false)}
        onChanged={() => {
          void client.invalidateQueries({ queryKey: ['activityPresets', habitId] });
          showToast('Quick actions updated.', 'success');
        }}
      />
    </ScreenLayout>
  );
}
function daysLabel(mask: number): string {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const names = labels.filter((_, day) => (mask & (1 << day)) !== 0);
  return names.length === 7 ? 'Daily' : names.join(', ');
}

export function HabitHistoryScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'good' | 'bad'>('all');
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const query = useQuery({
    queryKey: ['habits', 'history', filter],
    queryFn: async () =>
      Promise.all(
        (await listHabits(filter, true)).map(async (habit) => ({
          habit,
          bundle: await getHabitBundle(habit.id, true),
        })),
      ),
  });
  if (!canAccessPrivateRoutes(status)) return <Redirect href="/" />;
  return (
    <ScreenLayout
      bottomNavigation={<HabitNavigation selected="history" />}
      header={{ title: 'History', subtitle: 'Your habits, day by day.' }}
    >
      <View className="mb-4 flex-row">
        {(['all', 'good', 'bad'] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === item }}
            onPress={() => setFilter(item)}
            className={`mr-2 rounded-full px-4 py-2 ${filter === item ? 'bg-indigo-100' : 'bg-white'}`}
          >
            <Text className="capitalize text-primary">{item}</Text>
          </Pressable>
        ))}
      </View>
      <View className="mb-4 flex-row">
        {([7, 30, 90] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: period === value }}
            onPress={() => setPeriod(value)}
            className={`mr-2 rounded-full px-4 py-2 ${period === value ? 'bg-indigo-100' : 'bg-white'}`}
          >
            <Text
              className={`text-sm ${period === value ? 'font-semibold text-primary' : 'text-slate-600'}`}
            >
              {value} days
            </Text>
          </Pressable>
        ))}
      </View>
      {query.isLoading ? (
        <Text className="py-10 text-center text-slate-500">Loading history…</Text>
      ) : query.isError ? (
        <ErrorState message="Could not load your history." onRetry={() => void query.refetch()} />
      ) : query.data?.length ? (
        query.data.map(({ habit, bundle }) => (
          <Pressable
            key={habit.id}
            accessibilityRole="button"
            onPress={() => router.push(habitHref(`/habits/${habit.id}`))}
            className="mb-4 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <View className="mb-3 flex-row justify-between">
              <Text className="font-semibold text-ink">{habit.name}</Text>
              <Text className="text-sm text-slate-500">
                {completionPercent(habit.streak.days.slice(-period))}% · last {period} days
              </Text>
              {habit.status === 'archived' ? (
                <Text className="text-xs text-slate-500">Archived</Text>
              ) : null}
            </View>
            <DayPills days={habit.streak.days} />
            {bundle?.entries.slice(0, 3).map((entry) => (
              <Text key={entry.id} className="mb-1 text-sm capitalize text-slate-600">
                {entry.local_date} · {entry.kind.replace('_', ' ')}
                {entry.value ? ` · ${entry.value} ${entry.unit}` : ''}
              </Text>
            ))}
            {bundle?.history.slice(0, 2).map((event, index) => (
              <Text
                key={`${event.occurred_at}-${index}`}
                className="mb-1 text-xs capitalize text-slate-500"
              >
                {event.local_date} · {event.event_type.replace('_', ' ')}
              </Text>
            ))}
          </Pressable>
        ))
      ) : (
        <EmptyState
          title="Your history starts here"
          message="Daily check-ins and habit changes will appear here."
        />
      )}
    </ScreenLayout>
  );
}
function completionPercent(days: Array<{ state: string }>): number {
  const considered = days.filter(
    ({ state }) => !['unscheduled', 'paused', 'pending', 'unknown'].includes(state),
  );
  if (!considered.length) return 0;
  const successful = considered.filter(({ state }) => ['completed', 'clean'].includes(state));
  return Math.round((successful.length * 100) / considered.length);
}
