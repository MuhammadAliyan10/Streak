import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { useToast } from '../../components/feedback/toast-provider';
import { AppHeader } from '../../components/layout/app-header';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { FormTextField } from '../../components/ui/form-text-field';
import { goalProgressInputSchema, goalSchema, type GoalInput } from './goal-domain';
import {
  addGoalProgress,
  deleteGoalMilestone,
  formatGoalTarget,
  getDeletedGoals,
  getGoalBundle,
  getGoals,
  getLinkedHabitsForGoal,
  saveGoal,
  saveGoalMilestone,
  setGoalStatus,
  type GoalRecord,
} from './goal-repository';
import { HabitNavigation } from '../habits/habit-navigation';
import { todayInTimezone } from '../habits/domain/habit-domain';
import { ActivityLogRow, ActivityLogSheet } from '../habits/activity-components';
import {
  deleteActivityLog,
  restoreActivityLog,
  updateActivityLog,
  type ActivityEntry,
  type QuickActivity,
} from '../habits/habit-repository';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const today = () => todayInTimezone(timezone);
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
      className={`mb-2 mr-2 rounded-full border px-4 py-3 ${selected ? 'border-primary bg-indigo-50' : 'border-slate-200 bg-white'}`}
    >
      <Text className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-slate-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <View className="mb-5">
      <Text className="mb-2 text-base font-bold text-ink">{title}</Text>
      {children}
    </View>
  );
}
const blankGoal = (): GoalInput => ({
  title: '',
  description: '',
  category: 'personal',
  periodType: 'custom',
  model: 'cumulative',
  recurrence: '',
  measurement: 'count',
  targetValue: '1',
  unit: 'count',
  startDate: today(),
  endDate: `${today().slice(0, 4)}-12-31`,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timezone,
  habitIds: [],
});

export function GoalsOverviewScreen() {
  const router = useRouter();
  const query = useQuery({ queryKey: ['goals'], queryFn: () => getGoals({ localDate: today() }) });
  const deleted = useQuery({ queryKey: ['goals', 'deleted'], queryFn: getDeletedGoals });
  const current = (query.data ?? []).filter(
    (goal) => !['archived', 'ended', 'achieved'].includes(goal.status),
  );
  const past = (query.data ?? []).filter((goal) =>
    ['archived', 'ended', 'achieved'].includes(goal.status),
  );
  return (
    <ScreenLayout bottomNavigation={<HabitNavigation selected="today" />}>
      <AppHeader title="Goals" subtitle="See the progress you’re building." />
      <View className="mt-4">
        <Button title="Create goal" onPress={() => router.push('/goals/new' as Href)} />
      </View>
      {query.isLoading ? (
        <Text className="mt-6 text-center text-slate-500">Loading goals…</Text>
      ) : query.isError ? (
        <ErrorState
          message="Goals could not load. Try again in a moment."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !current.length ? (
        <View className="mt-6">
          <EmptyState
            title="No active goals yet"
            message="Set a target and connect it to the activity you already record."
          />
          <View className="mt-3">
            <Button title="Create a goal" onPress={() => router.push('/goals/new' as Href)} />
          </View>
        </View>
      ) : (
        <View className="mt-5 gap-3">
          {current.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onPress={() => router.push(`/goals/${goal.id}` as Href)}
            />
          ))}
        </View>
      )}
      {past.length ? (
        <View className="mt-7">
          <Text className="mb-3 text-lg font-bold text-ink">Completed and archived</Text>
          <View className="gap-3">
            {past.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onPress={() => router.push(`/goals/${goal.id}` as Href)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {deleted.data?.length ? (
        <View className="mt-7">
          <Text className="mb-3 text-lg font-bold text-ink">Recently deleted</Text>
          <View className="gap-3">
            {deleted.data.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onPress={() => router.push(`/goals/${goal.id}` as Href)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScreenLayout>
  );
}
function GoalCard({ goal, onPress }: { goal: GoalRecord; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-start justify-between">
        <View className="mr-3 flex-1">
          <Text className="text-base font-bold text-ink">{goal.title}</Text>
          <Text className="mt-1 text-sm text-slate-500">
            {goal.status === 'active'
              ? `${goal.model === 'recurring' ? 'Consistency' : 'Cumulative'} · ${goal.startDate} – ${goal.endDate}`
              : goal.status}
          </Text>
        </View>
        <Text className="font-bold text-primary">{goal.progress.progressPercent}%</Text>
      </View>
      <View className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <View
          className="h-2 rounded-full bg-primary"
          style={{ width: `${goal.progress.progressPercent}%` }}
        />
      </View>
      <Text className="mt-2 text-sm text-slate-600">
        {goal.model === 'recurring'
          ? `${goal.progress.achievedPeriods}/${goal.progress.elapsedPeriods} periods met`
          : `${goal.progress.totalValue.toFixed(1)} / ${formatGoalTarget(goal)}`}
      </Text>
    </Pressable>
  );
}

function GoalDatePicker({
  label,
  value,
  visible,
  onOpen,
  onClose,
  onChange,
}: {
  label: string;
  value: string;
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}) {
  const [year, month, day] = value.split('-').map(Number);
  const selected = new Date(year || 2000, (month || 1) - 1, day || 1, 12);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        onPress={onOpen}
        className="mb-5 min-h-12 flex-1 justify-center rounded-xl border border-slate-300 bg-white px-3"
      >
        <Text className="text-xs text-slate-500">{label}</Text>
        <Text className="mt-1 text-base text-ink">{value}</Text>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View className="flex-1 justify-end bg-slate-900/40">
          <View className="rounded-t-3xl bg-white p-5">
            <DateTimePicker
              value={selected}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(event: DateTimePickerEvent, picked?: Date) => {
                if (event.type === 'dismissed') {
                  onClose();
                  return;
                }
                if (picked) {
                  onChange(
                    `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}`,
                  );
                  if (Platform.OS !== 'ios') onClose();
                }
              }}
            />
            <Button title="Done" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function GoalFormScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ goalId?: string }>();
  const goalId = typeof params.goalId === 'string' ? params.goalId : undefined;
  const existing = useQuery({
    queryKey: ['goal', goalId],
    queryFn: () => getGoalBundle(goalId!),
    enabled: !!goalId,
  });
  const habits = useQuery({ queryKey: ['goal-habit-options'], queryFn: getLinkedHabitsForGoal });
  const editValues = useMemo(
    () =>
      existing.data
        ? {
            title: existing.data.goal.title,
            description: existing.data.goal.description,
            category: existing.data.goal.category as GoalInput['category'],
            periodType: existing.data.goal.periodType,
            model: existing.data.goal.model,
            recurrence: existing.data.goal.recurrence ?? '',
            measurement: existing.data.goal.measurement as GoalInput['measurement'],
            targetValue:
              formatGoalTarget(existing.data.goal).split(' ')[0] ??
              String(existing.data.goal.targetValue),
            unit: existing.data.goal.unit,
            startDate: existing.data.goal.startDate,
            endDate: existing.data.goal.endDate,
            weekdays: Array.from({ length: 7 }, (_, index) => index).filter(
              (day) => existing.data!.goal.weekdayMask & (1 << day),
            ),
            timezone: existing.data.goal.timezone,
            habitIds: existing.data.goal.linkedHabits.map((habit) => habit.id),
          }
        : null,
    [existing.data],
  );
  const form = useForm<GoalInput>({
    resolver: zodResolver(goalSchema),
    defaultValues: blankGoal(),
  });
  useEffect(() => {
    if (editValues) form.reset(editValues);
  }, [editValues, form.reset]);
  const model = form.watch('model');
  const measurement = form.watch('measurement');
  const habitIds = form.watch('habitIds');
  const [datePickerField, setDatePickerField] = useState<'startDate' | 'endDate' | null>(null);
  const mutation = useMutation({
    mutationFn: (input: GoalInput) => saveGoal(input, goalId),
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: ['goals'] });
      await client.invalidateQueries({ queryKey: ['goal'] });
      showToast(goalId ? 'Goal updated.' : 'Goal created.', 'success');
      router.replace(`/goals/${id}` as Href);
    },
    onError: (error) =>
      form.setError('title', {
        type: 'server',
        message: error instanceof Error ? error.message : 'Could not save this goal.',
      }),
  });
  const setChoice = <K extends keyof GoalInput>(field: K, value: GoalInput[K]) =>
    form.setValue(field, value as never, { shouldDirty: true, shouldValidate: true });
  if (goalId && existing.isLoading)
    return (
      <ScreenLayout>
        <Text className="mt-10 text-center text-slate-500">Loading goal…</Text>
      </ScreenLayout>
    );
  return (
    <ScreenLayout>
      <AppHeader
        title={goalId ? 'Edit goal' : 'New goal'}
        subtitle="Start with a clear target and time frame."
      />
      {goalId ? (
        <Text className="mt-3 text-sm text-slate-500">
          Past progress keeps its original meaning. Measurement, recurrence, and date range are
          fixed; targets and daily weekdays can change going forward.
        </Text>
      ) : null}
      <ScrollView
        className="mt-4"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 36 }}
      >
        <FormTextField
          control={form.control}
          name="title"
          label="Goal name"
          placeholder="e.g. Study consistently"
          autoCapitalize="sentences"
        />
        <FormTextField
          control={form.control}
          name="description"
          label="Description · optional"
          placeholder="Why this matters to you"
          multiline
          numberOfLines={3}
        />
        <Section title="Category">
          <View className="flex-row flex-wrap">
            {(
              ['health', 'learning', 'fitness', 'work', 'finance', 'personal', 'other'] as const
            ).map((item) => (
              <Choice
                key={item}
                label={item}
                selected={form.watch('category') === item}
                onPress={() => setChoice('category', item)}
              />
            ))}
          </View>
        </Section>
        <Section title="How progress works">
          <View className="flex-row flex-wrap">
            <Choice
              label="Build a total"
              selected={model === 'cumulative'}
              onPress={() => {
                setChoice('model', 'cumulative');
                setChoice('recurrence', '');
              }}
            />
            <Choice
              label="Repeat each period"
              selected={model === 'recurring'}
              onPress={() => {
                setChoice('model', 'recurring');
                setChoice('recurrence', 'daily');
              }}
            />
          </View>
          {model === 'recurring' ? (
            <View className="flex-row flex-wrap">
              {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((item) => (
                <Choice
                  key={item}
                  label={item}
                  selected={form.watch('recurrence') === item}
                  onPress={() => setChoice('recurrence', item)}
                />
              ))}
            </View>
          ) : null}
          <View className="flex-row flex-wrap">
            {(['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const).map((item) => (
              <Choice
                key={item}
                label={item}
                selected={form.watch('periodType') === item}
                onPress={() => setChoice('periodType', item)}
              />
            ))}
          </View>
        </Section>
        <Section title="Measurement">
          <View className="flex-row flex-wrap">
            {(
              ['duration', 'distance', 'count', 'pages', 'volume', 'quantity', 'days'] as const
            ).map((item) => (
              <Choice
                key={item}
                label={item}
                selected={measurement === item}
                onPress={() => {
                  setChoice('measurement', item);
                  setChoice(
                    'unit',
                    item === 'duration'
                      ? 'minutes'
                      : item === 'distance'
                        ? 'km'
                        : item === 'pages'
                          ? 'pages'
                          : item === 'days'
                            ? 'days'
                            : 'count',
                  );
                }}
              />
            ))}
          </View>
        </Section>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="targetValue"
              label={model === 'recurring' ? 'Target each period' : 'Total target'}
              placeholder="1"
              keyboardType="decimal-pad"
            />
          </View>
          {measurement !== 'days' ? (
            <View className="flex-1">
              <FormTextField
                control={form.control}
                name="unit"
                label="Unit"
                placeholder="minutes"
                autoCapitalize="none"
              />
            </View>
          ) : null}
        </View>
        <View className="flex-row gap-3">
          <GoalDatePicker
            label="Start date"
            value={form.watch('startDate')}
            visible={datePickerField === 'startDate'}
            onOpen={() => setDatePickerField('startDate')}
            onClose={() => setDatePickerField(null)}
            onChange={(value) =>
              form.setValue('startDate', value, { shouldDirty: true, shouldValidate: true })
            }
          />
          <GoalDatePicker
            label="End date"
            value={form.watch('endDate')}
            visible={datePickerField === 'endDate'}
            onOpen={() => setDatePickerField('endDate')}
            onClose={() => setDatePickerField(null)}
            onChange={(value) =>
              form.setValue('endDate', value, { shouldDirty: true, shouldValidate: true })
            }
          />
        </View>
        {model === 'recurring' && form.watch('recurrence') === 'daily' ? (
          <Section title="Scheduled weekdays">
            <View className="flex-row flex-wrap">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, day) => (
                <Choice
                  key={name}
                  label={name}
                  selected={form.watch('weekdays').includes(day)}
                  onPress={() =>
                    setChoice(
                      'weekdays',
                      habitIds && form.getValues('weekdays').includes(day)
                        ? form.getValues('weekdays').filter((item) => item !== day)
                        : [...form.getValues('weekdays'), day].sort(),
                    )
                  }
                />
              ))}
            </View>
          </Section>
        ) : null}
        <Section title="Linked habits · optional">
          <Text className="mb-2 text-sm text-slate-500">
            Existing activity counts toward this goal without creating another log.
          </Text>
          <View className="flex-row flex-wrap">
            {(habits.data ?? [])
              .filter((habit) => habit.status !== 'archived')
              .map((habit) => (
                <Choice
                  key={habit.id}
                  label={habit.name}
                  selected={habitIds.includes(habit.id)}
                  onPress={() =>
                    setChoice(
                      'habitIds',
                      habitIds.includes(habit.id)
                        ? habitIds.filter((id) => id !== habit.id)
                        : [...habitIds, habit.id],
                    )
                  }
                />
              ))}
          </View>
        </Section>
        {Object.values(form.formState.errors).map((error, index) =>
          error?.message ? (
            <Text key={index} className="mb-2 text-sm text-red-700">
              {error.message}
            </Text>
          ) : null,
        )}
        <Button
          title={goalId ? 'Save changes' : 'Create goal'}
          loading={mutation.isPending}
          disabled={mutation.isPending}
          onPress={form.handleSubmit((value) => mutation.mutateAsync(value).catch(() => undefined))}
        />
        <View className="mt-3">
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              if (!form.formState.isDirty) {
                router.back();
                return;
              }
              Alert.alert('Discard changes?', 'Your goal edits will be lost.', [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => router.back() },
              ]);
            }}
          />
        </View>
      </ScrollView>
    </ScreenLayout>
  );
}

const progressDefaults = { amount: '', localDate: today(), note: '' };
function ProgressModal({
  visible,
  goal,
  onClose,
  onSave,
}: {
  visible: boolean;
  goal: GoalRecord;
  onClose: () => void;
  onSave: (amount: number, date: string, note: string) => Promise<void>;
}) {
  const form = useForm({
    resolver: zodResolver(goalProgressInputSchema),
    defaultValues: progressDefaults,
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <View className="rounded-t-3xl bg-canvas p-5">
          <Text className="mb-4 text-xl font-bold text-ink">Record progress</Text>
          {goal.measurement === 'days' ? (
            <FormTextField
              control={form.control}
              name="amount"
              label="Days achieved"
              keyboardType="number-pad"
              placeholder="1"
            />
          ) : (
            <FormTextField
              control={form.control}
              name="amount"
              label={`Amount · ${goal.unit}`}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          )}
          <FormTextField control={form.control} name="localDate" label="Date · YYYY-MM-DD" />
          <FormTextField control={form.control} name="note" label="Note · optional" multiline />
          <Button
            title="Save progress"
            loading={form.formState.isSubmitting}
            onPress={form.handleSubmit(async (values) => {
              try {
                await onSave(Number(values.amount), values.localDate, values.note);
                onClose();
              } catch (error) {
                form.setError('amount', {
                  message: error instanceof Error ? error.message : 'Could not record progress.',
                });
              }
            })}
          />
          <View className="mt-3">
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
const milestoneSchema = z.object({
  title: z.string().trim().min(2, 'Name the milestone.').max(80),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a positive target.'),
  localDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
});

export function GoalDetailScreen() {
  const { goalId } = useLocalSearchParams<{ goalId?: string }>();
  const id = typeof goalId === 'string' ? goalId : '';
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const [progressOpen, setProgressOpen] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<{
    id: string;
    title: string;
    targetValue: number;
    dueDate: string | null;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const query = useQuery({
    queryKey: ['goal', id],
    queryFn: () => getGoalBundle(id),
    enabled: !!id,
  });
  const update = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'archive' | 'delete' | 'restore') =>
      setGoalStatus(id, action),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['goal'] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      showToast('Goal updated.', 'success');
    },
    onError: () => showToast('Could not update this goal.', 'error'),
  });
  const editLog = useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: QuickActivity }) =>
      updateActivityLog(entryId, input),
    onSuccess: async () => {
      setSelectedEntry(null);
      await client.invalidateQueries({ queryKey: ['goal', id] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      showToast('Activity corrected.', 'success');
    },
    onError: () => showToast('Could not correct this activity.', 'error'),
  });
  const removeLog = useMutation({
    mutationFn: deleteActivityLog,
    onSuccess: async () => {
      setSelectedEntry(null);
      await client.invalidateQueries({ queryKey: ['goal', id] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      showToast('Activity removed. It can be restored from this history.', 'success');
    },
    onError: () => showToast('Could not remove this activity.', 'error'),
  });
  const restoreLog = useMutation({
    mutationFn: restoreActivityLog,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['goal', id] });
      await client.invalidateQueries({ queryKey: ['goals'] });
      showToast('Activity restored.', 'success');
    },
    onError: () => showToast('Could not restore this activity.', 'error'),
  });
  const milestoneForm = useForm({
    resolver: zodResolver(milestoneSchema),
    defaultValues: { title: '', amount: '1', localDate: '' },
  });
  if (query.isLoading)
    return (
      <ScreenLayout>
        <Text className="mt-10 text-center text-slate-500">Loading goal…</Text>
      </ScreenLayout>
    );
  if (!query.data)
    return (
      <ScreenLayout>
        <ErrorState
          message="Goal not found. It may have been removed."
          onRetry={() => {
            void query.refetch();
          }}
        />
      </ScreenLayout>
    );
  const { goal, milestones, events, activity, versions } = query.data;
  return (
    <ScreenLayout>
      <AppHeader
        title={goal.title}
        subtitle={`${goal.startDate} – ${goal.endDate} · ${goal.status}`}
      />
      <ScrollView className="mt-4" contentContainerStyle={{ paddingBottom: 36 }}>
        <View className="rounded-2xl border border-slate-200 bg-white p-5">
          <Text className="text-4xl font-bold text-primary">{goal.progress.progressPercent}%</Text>
          <View className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
            <View
              className="h-3 rounded-full bg-primary"
              style={{ width: `${goal.progress.progressPercent}%` }}
            />
          </View>
          <Text className="mt-3 text-sm text-slate-600">
            {goal.model === 'recurring'
              ? `${goal.progress.achievedPeriods} of ${goal.progress.elapsedPeriods} scheduled periods met · ${goal.progress.missedPeriods} missed`
              : `${goal.progress.totalValue.toFixed(2)} / ${formatGoalTarget(goal)}`}
          </Text>
          <Text className="mt-1 text-sm text-slate-500">
            {goal.progress.daysRemaining} days remaining · {goal.progress.scheduledPeriods}{' '}
            scheduled periods
          </Text>
          {goal.description ? (
            <Text className="mt-4 text-sm text-slate-700">{goal.description}</Text>
          ) : null}
        </View>
        <View className="mt-3 gap-2">
          {goal.status === 'deleted' ? (
            <Button
              title="Restore goal"
              loading={update.isPending}
              onPress={() => update.mutate('restore')}
            />
          ) : (
            <>
              <Button title="Record progress" onPress={() => setProgressOpen(true)} />
              <Button
                title="Edit goal"
                variant="secondary"
                onPress={() => router.push(`/goals/edit?goalId=${encodeURIComponent(id)}` as Href)}
              />
              {goal.status === 'paused' ? (
                <Button
                  title="Resume goal"
                  variant="secondary"
                  loading={update.isPending}
                  onPress={() => update.mutate('resume')}
                />
              ) : (
                <Button
                  title="Pause goal"
                  variant="secondary"
                  loading={update.isPending}
                  onPress={() => update.mutate('pause')}
                />
              )}
              <Button
                title="Archive goal"
                variant="quiet"
                loading={update.isPending}
                onPress={() =>
                  Alert.alert('Archive this goal?', 'Its history and linked habits will remain.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Archive', onPress: () => update.mutate('archive') },
                  ])
                }
              />
              <Button
                title="Delete goal"
                variant="quiet"
                loading={update.isPending}
                onPress={() =>
                  Alert.alert(
                    'Delete this goal?',
                    'This is recoverable. Linked habits and activity logs will remain.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => update.mutate('delete'),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </View>
        <Section title="Linked habits">
          {goal.linkedHabits.length ? (
            goal.linkedHabits.map((habit) => (
              <Text key={habit.id} className="py-2 text-sm text-slate-700">
                • {habit.name} · {habit.streak.current} current streak
              </Text>
            ))
          ) : (
            <Text className="text-sm text-slate-500">
              No linked habits. Manually recorded activity contributes.
            </Text>
          )}
        </Section>
        <Section title="Milestones">
          <Button
            title="Add milestone"
            variant="secondary"
            onPress={() => {
              setSelectedMilestone(null);
              milestoneForm.reset({ title: '', amount: '1', localDate: '' });
              setMilestoneOpen(true);
            }}
          />
          {milestones.map((item) => (
            <View
              key={item.id}
              className="mt-2 flex-row items-center justify-between rounded-xl bg-white p-3"
            >
              <View className="flex-1">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    milestoneForm.reset({
                      title: item.title,
                      amount:
                        formatGoalTarget({ ...goal, targetValue: item.targetValue }).split(
                          ' ',
                        )[0] ?? String(item.targetValue),
                      localDate: item.dueDate ?? '',
                    });
                    setSelectedMilestone(item);
                    setMilestoneOpen(true);
                  }}
                >
                  <Text className="font-semibold text-ink">{item.title}</Text>
                </Pressable>
                <Text className="text-sm text-slate-500">
                  Target {formatGoalTarget({ ...goal, targetValue: item.targetValue })} ·{' '}
                  {item.achieved ? 'Reached' : (item.dueDate ?? 'No due date')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete milestone ${item.title}`}
                onPress={() =>
                  Alert.alert('Delete milestone?', item.title, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        await deleteGoalMilestone(id, item.id);
                        await client.invalidateQueries({ queryKey: ['goal', id] });
                      },
                    },
                  ])
                }
              >
                <Text className="px-3 py-2 text-red-700">Delete</Text>
              </Pressable>
            </View>
          ))}
        </Section>
        <Section title="Progress history">
          {activity.some((entry) => !entry.deleted_at) ? (
            activity
              .filter((entry) => !entry.deleted_at)
              .slice(0, 20)
              .map((entry) => (
                <ActivityLogRow
                  key={entry.id}
                  entry={entry}
                  onPress={() => setSelectedEntry(entry)}
                />
              ))
          ) : (
            <Text className="text-sm text-slate-500">No manual goal activity yet.</Text>
          )}
          {activity.some((entry) => !!entry.deleted_at) ? (
            <Text className="mb-2 mt-3 font-semibold text-ink">Removed activity</Text>
          ) : null}
          {activity
            .filter((entry) => !!entry.deleted_at)
            .slice(0, 20)
            .map((entry) => (
              <ActivityLogRow
                key={entry.id}
                entry={entry}
                onRestore={() => restoreLog.mutate(entry.id)}
              />
            ))}
          {events.slice(0, 8).map((event, index) => (
            <Text key={`${event.occurredAt}-${index}`} className="py-1 text-xs text-slate-400">
              {event.localDate} · {event.eventType}
            </Text>
          ))}
          {versions.length > 1 ? (
            <Text className="mt-2 text-xs text-slate-500">
              Target changes are recorded by effective date.
            </Text>
          ) : null}
        </Section>
      </ScrollView>
      <ProgressModal
        visible={progressOpen}
        goal={goal}
        onClose={() => setProgressOpen(false)}
        onSave={async (amount, date, note) => {
          await addGoalProgress(id, amount, date, note);
          await client.invalidateQueries({ queryKey: ['goal', id] });
          await client.invalidateQueries({ queryKey: ['goals'] });
          showToast('Progress recorded.', 'success');
        }}
      />
      {selectedEntry ? (
        <ActivityLogSheet
          visible
          habit={goal.linkedHabits.find((habit) => habit.id === selectedEntry.habit_id) ?? null}
          existing={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onSave={(input, entryId) =>
            entryId ? editLog.mutateAsync({ entryId, input }) : Promise.resolve()
          }
          onDelete={() =>
            Alert.alert(
              'Remove this activity?',
              'It will no longer count toward goal progress and can be restored.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => removeLog.mutate(selectedEntry.id),
                },
              ],
            )
          }
        />
      ) : null}
      <Modal
        visible={milestoneOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMilestoneOpen(false)}
      >
        <View className="flex-1 justify-end bg-slate-900/40">
          <View className="rounded-t-3xl bg-canvas p-5">
            <Text className="mb-4 text-xl font-bold text-ink">
              {selectedMilestone ? 'Edit milestone' : 'Add milestone'}
            </Text>
            <FormTextField control={milestoneForm.control} name="title" label="Milestone name" />
            <FormTextField
              control={milestoneForm.control}
              name="amount"
              label="Target value"
              keyboardType="number-pad"
            />
            <FormTextField
              control={milestoneForm.control}
              name="localDate"
              label="Due date · optional YYYY-MM-DD"
            />
            <Button
              title="Save milestone"
              loading={milestoneForm.formState.isSubmitting}
              onPress={milestoneForm.handleSubmit(async (value) => {
                try {
                  await saveGoalMilestone(
                    id,
                    value.title,
                    Number(value.amount),
                    value.localDate || null,
                    selectedMilestone?.id,
                  );
                  setMilestoneOpen(false);
                  setSelectedMilestone(null);
                  milestoneForm.reset();
                  await client.invalidateQueries({ queryKey: ['goal', id] });
                  showToast('Milestone added.', 'success');
                } catch (error) {
                  milestoneForm.setError('title', {
                    message: error instanceof Error ? error.message : 'Could not save milestone.',
                  });
                }
              })}
            />
            <View className="mt-3">
              <Button title="Cancel" variant="secondary" onPress={() => setMilestoneOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}
