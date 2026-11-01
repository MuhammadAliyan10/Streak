import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useToast } from '../../components/feedback/toast-provider';
import { AppHeader } from '../../components/layout/app-header';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { FormTextField } from '../../components/ui/form-text-field';
import { getPresetsForHabits, listHabits } from '../habits/habit-repository';
import { getTasksForDate } from '../planner/planner-repository';
import { todayInTimezone } from '../habits/domain/habit-domain';
import { HabitNavigation } from '../habits/habit-navigation';
import {
  routineSchema,
  routineStepSchema,
  type RoutineInput,
  type RoutineStepInput,
} from './routine-domain';
import {
  archiveRoutine,
  completeRoutineStep,
  getActiveRoutineRun,
  getRoutine,
  getRoutineRun,
  getRoutineRunHistory,
  getRoutines,
  getRoutinesForDate,
  saveRoutine,
  skipRoutineStep,
  startRoutineRun,
  updateRoutineRun,
  type RoutineRecord,
} from './routine-repository';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const localDate = todayInTimezone(timezone);
const freshStep = (): RoutineStepInput => ({
  title: '',
  kind: 'checklist',
  habitId: '',
  taskId: '',
  targetMinutes: '',
  measurement: '',
  value: '',
  unit: '',
  category: 'other',
  presetId: '',
  note: '',
  skippable: true,
});
const freshRoutine = (): RoutineInput => ({
  name: '',
  description: '',
  icon: 'sparkles',
  color: 'indigo',
  startTime: '',
  windowStart: '',
  windowEnd: '',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  estimatedMinutes: '',
  timezone,
  steps: [],
});
function Chip({
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
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function toRoutineStepInput(step: RoutineRecord['steps'][number]): RoutineStepInput {
  return {
    title: step.title,
    kind: step.kind,
    habitId: step.habitId,
    taskId: step.taskId,
    targetMinutes: step.targetMinutes,
    measurement: step.measurement,
    value: step.value,
    unit: step.unit,
    category: step.category,
    presetId: step.presetId,
    note: step.note,
    skippable: step.skippable,
  };
}

export function RoutinesScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ queryKey: ['routines'], queryFn: getRoutines });
  const scheduled = useQuery({
    queryKey: ['routines', 'date', localDate],
    queryFn: () => getRoutinesForDate(localDate),
  });
  const archive = useMutation({
    mutationFn: archiveRoutine,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['routines'] });
      showToast('Routine archived.', 'success');
    },
  });
  return (
    <ScreenLayout bottomNavigation={<HabitNavigation selected="today" />}>
      <AppHeader title="Routines" subtitle="Simple sequences for the parts of your day." />
      <View className="mt-4">
        <Button title="Create routine" onPress={() => router.push('/routines/new' as Href)} />
      </View>
      {scheduled.data?.length ? (
        <View className="mt-6">
          <Text className="mb-3 text-lg font-bold text-ink">Scheduled today</Text>
          {scheduled.data.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              onOpen={() => router.push(`/routines/${routine.id}` as Href)}
              onStart={() =>
                router.push(`/routines/run?routineId=${encodeURIComponent(routine.id)}` as Href)
              }
            />
          ))}
        </View>
      ) : null}
      {query.isLoading ? (
        <Text className="mt-6 text-center text-slate-500">Loading routines…</Text>
      ) : query.isError ? (
        <ErrorState
          message="Routines could not load. Try again in a moment."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !query.data?.length ? (
        <View className="mt-6">
          <EmptyState
            title="No routines yet"
            message="Make a reusable sequence from your habits, tasks, timers, or checklists."
          />
          <View className="mt-3">
            <Button title="Create a routine" onPress={() => router.push('/routines/new' as Href)} />
          </View>
        </View>
      ) : (
        <View className="mt-6 gap-3">
          {query.data.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              onOpen={() => router.push(`/routines/${routine.id}` as Href)}
              onStart={() =>
                router.push(`/routines/run?routineId=${encodeURIComponent(routine.id)}` as Href)
              }
              onArchive={() =>
                Alert.alert('Archive routine?', 'Past runs will remain available.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Archive',
                    style: 'destructive',
                    onPress: () => archive.mutate(routine.id),
                  },
                ])
              }
            />
          ))}
        </View>
      )}
    </ScreenLayout>
  );
}
function RoutineCard({
  routine,
  onOpen,
  onStart,
  onArchive,
}: {
  routine: RoutineRecord;
  onOpen: () => void;
  onStart: () => void;
  onArchive?: () => void;
}) {
  return (
    <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
      <Pressable onPress={onOpen}>
        <Text className="text-base font-bold text-ink">{routine.name}</Text>
        <Text className="mt-1 text-sm text-slate-500">
          {routine.steps.length} steps{routine.startTime ? ` · ${routine.startTime}` : ''}
          {routine.estimatedMinutes ? ` · about ${routine.estimatedMinutes} min` : ''}
        </Text>
      </Pressable>
      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <Button title={routine.activeRunId ? 'Resume' : 'Start'} onPress={onStart} />
        </View>
        {onArchive ? (
          <View className="flex-1">
            <Button title="Edit" variant="secondary" onPress={onOpen} />
          </View>
        ) : null}
      </View>
      {onArchive ? (
        <Pressable
          accessibilityRole="button"
          onPress={onArchive}
          className="mt-2 self-start px-2 py-1"
        >
          <Text className="text-sm text-slate-500">Archive</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function RoutineFormScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ routineId?: string }>();
  const routineId = typeof params.routineId === 'string' ? params.routineId : undefined;
  const existing = useQuery({
    queryKey: ['routine', routineId],
    queryFn: () => getRoutine(routineId!),
    enabled: !!routineId,
  });
  const habits = useQuery({ queryKey: ['routine-habits'], queryFn: () => listHabits('all') });
  const presets = useQuery({
    queryKey: ['routine-presets', (habits.data ?? []).map((habit) => habit.id).join(',')],
    queryFn: () => getPresetsForHabits((habits.data ?? []).map((habit) => habit.id)),
    enabled: !!habits.data,
  });
  const tasks = useQuery({
    queryKey: ['routine-tasks'],
    queryFn: () => getTasksForDate(localDate),
  });
  const input = useMemo(
    () =>
      existing.data
        ? {
            name: existing.data.name,
            description: existing.data.description,
            icon: existing.data.icon,
            color: existing.data.color,
            startTime: existing.data.startTime ?? '',
            windowStart: existing.data.windowStart ?? '',
            windowEnd: existing.data.windowEnd ?? '',
            weekdays: existing.data.weekdays,
            estimatedMinutes: existing.data.estimatedMinutes
              ? String(existing.data.estimatedMinutes)
              : '',
            timezone: existing.data.timezone,
            steps: existing.data.steps.map(toRoutineStepInput),
          }
        : freshRoutine(),
    [existing.data],
  );
  const form = useForm<RoutineInput>({ resolver: zodResolver(routineSchema), values: input });
  const [stepOpen, setStepOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [stepInitial, setStepInitial] = useState<RoutineStepInput>(freshStep);
  const mutation = useMutation({
    mutationFn: (value: RoutineInput) => saveRoutine(value, routineId),
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: ['routines'] });
      await client.invalidateQueries({ queryKey: ['routine'] });
      showToast(routineId ? 'Routine updated.' : 'Routine created.', 'success');
      router.replace(`/routines/${id}` as Href);
    },
    onError: (error) =>
      form.setError('name', {
        message: error instanceof Error ? error.message : 'Could not save the routine.',
      }),
  });
  const steps = form.watch('steps');
  if (routineId && existing.isLoading)
    return (
      <ScreenLayout>
        <Text className="mt-10 text-center text-slate-500">Loading routine…</Text>
      </ScreenLayout>
    );
  const changeStep = (index: number, offset: number) => {
    const value = [...form.getValues('steps')];
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    [value[index], value[target]] = [value[target]!, value[index]!];
    form.setValue('steps', value, { shouldDirty: true, shouldValidate: true });
  };
  return (
    <ScreenLayout>
      <AppHeader
        title={routineId ? 'Edit routine' : 'New routine'}
        subtitle="Choose when it runs and arrange a few clear steps."
      />
      <ScrollView
        className="mt-4"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 36 }}
      >
        <FormTextField
          control={form.control}
          name="name"
          label="Routine name"
          placeholder="Morning routine"
        />
        <FormTextField
          control={form.control}
          name="description"
          label="Description · optional"
          multiline
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="startTime"
              label="Start time · optional"
              placeholder="07:00"
            />
          </View>
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="estimatedMinutes"
              label="Estimated minutes"
              keyboardType="number-pad"
              placeholder="30"
            />
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="windowStart"
              label="Flexible window · from"
              placeholder="07:00"
            />
          </View>
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="windowEnd"
              label="Until"
              placeholder="09:00"
            />
          </View>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="icon"
              label="Icon name"
              placeholder="sparkles"
            />
          </View>
          <View className="flex-1">
            <FormTextField
              control={form.control}
              name="color"
              label="Color name"
              placeholder="indigo"
            />
          </View>
        </View>
        <Text className="mb-2 text-sm font-semibold text-ink">Days</Text>
        <View className="mb-4 flex-row flex-wrap">
          {days.map((day, index) => (
            <Chip
              key={day}
              label={day}
              selected={form.watch('weekdays').includes(index)}
              onPress={() => {
                const value = form.getValues('weekdays');
                form.setValue(
                  'weekdays',
                  value.includes(index)
                    ? value.filter((item) => item !== index)
                    : [...value, index].sort(),
                  { shouldDirty: true, shouldValidate: true },
                );
              }}
            />
          ))}
        </View>
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-base font-bold text-ink">Ordered steps</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setEditingIndex(null);
              setStepInitial(freshStep());
              setStepOpen(true);
            }}
            className="rounded-lg bg-indigo-50 px-3 py-2"
          >
            <Text className="font-semibold text-primary">Add step</Text>
          </Pressable>
        </View>
        {steps.map((step, index) => {
          const habitName =
            (habits.data ?? []).find((item) => item.id === step.habitId)?.name ?? 'habit';
          const taskTitle =
            (tasks.data ?? []).find((item) => item.id === step.taskId)?.title ?? 'task';
          const detail =
            step.kind === 'habit'
              ? ` · ${habitName}`
              : step.kind === 'task'
                ? ` · ${taskTitle}`
                : '';
          return (
            <View
              key={`${index}-${step.title}`}
              className="mb-2 rounded-xl border border-slate-200 bg-white p-3"
            >
              <Text className="font-semibold text-ink">
                {index + 1}. {step.title || 'Untitled step'}
              </Text>
              <Text className="text-sm text-slate-500">
                {step.kind.replaceAll('_', ' ')}
                {detail}
              </Text>
              <View className="mt-2 flex-row gap-2">
                <Button
                  title="↑"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => changeStep(index, -1)}
                  disabled={index === 0}
                />
                <Button
                  title="↓"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => changeStep(index, 1)}
                  disabled={index === steps.length - 1}
                />
                <Button
                  title="Edit"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => {
                    setEditingIndex(index);
                    setStepInitial(steps[index]!);
                    setStepOpen(true);
                  }}
                />
                <Button
                  title="Remove"
                  variant="quiet"
                  fullWidth={false}
                  onPress={() =>
                    form.setValue(
                      'steps',
                      steps.filter((_, i) => i !== index),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                />
              </View>
            </View>
          );
        })}
        {Object.values(form.formState.errors).map((error, index) =>
          error?.message ? (
            <Text key={index} className="mb-2 text-sm text-red-700">
              {error.message}
            </Text>
          ) : null,
        )}
        <Button
          title={routineId ? 'Save changes' : 'Create routine'}
          loading={mutation.isPending}
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
              Alert.alert('Discard changes?', 'Your routine edits will be lost.', [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => router.back() },
              ]);
            }}
          />
        </View>
      </ScrollView>
      <RoutineStepModal
        visible={stepOpen}
        initial={stepInitial}
        habits={habits.data ?? []}
        tasks={tasks.data ?? []}
        presets={presets.data ?? []}
        onClose={() => setStepOpen(false)}
        onSave={(step) => {
          const value = [...form.getValues('steps')];
          if (editingIndex === null) value.push(step);
          else value[editingIndex] = step;
          form.setValue('steps', value, { shouldDirty: true, shouldValidate: true });
          setStepOpen(false);
        }}
      />
    </ScreenLayout>
  );
}
function RoutineStepModal({
  visible,
  initial,
  habits,
  tasks,
  presets,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: RoutineStepInput;
  habits: Awaited<ReturnType<typeof listHabits>>;
  tasks: Awaited<ReturnType<typeof getTasksForDate>>;
  presets: Awaited<ReturnType<typeof getPresetsForHabits>>;
  onClose: () => void;
  onSave: (step: RoutineStepInput) => void;
}) {
  const form = useForm<RoutineStepInput>({
    resolver: zodResolver(routineStepSchema),
    defaultValues: initial,
  });
  useEffect(() => form.reset(initial), [initial, form.reset]);
  const kind = form.watch('kind');
  const selectKind = (next: RoutineStepInput['kind']) => {
    form.setValue('kind', next, { shouldDirty: true, shouldValidate: true });
    if (next !== 'habit') form.setValue('habitId', '');
    if (next !== 'task') form.setValue('taskId', '');
    if (next !== 'quick_measurement') form.setValue('presetId', '');
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <ScrollView
          className="max-h-[90%] rounded-t-3xl bg-canvas p-5"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-4 text-xl font-bold text-ink">Routine step</Text>
          <FormTextField
            control={form.control}
            name="title"
            label="Step name"
            placeholder="Read for 20 minutes"
          />
          <View className="flex-row flex-wrap">
            {(['checklist', 'habit', 'task', 'timer', 'quick_measurement'] as const).map((item) => (
              <Chip
                key={item}
                label={item.replace('_', ' ')}
                selected={kind === item}
                onPress={() => selectKind(item)}
              />
            ))}
          </View>
          {kind === 'habit' ? (
            <View className="mb-3">
              <Text className="mb-2 text-sm font-medium text-ink">Choose habit</Text>
              <View className="flex-row flex-wrap">
                {habits
                  .filter((item) => item.status === 'active')
                  .map((habit) => (
                    <Chip
                      key={habit.id}
                      label={habit.name}
                      selected={form.watch('habitId') === habit.id}
                      onPress={() => {
                        form.setValue('habitId', habit.id, { shouldDirty: true });
                        form.setValue('title', form.getValues('title') || habit.name);
                      }}
                    />
                  ))}
              </View>
              <FormTextField
                control={form.control}
                name="value"
                label="Amount · optional for measurable habits"
                keyboardType="decimal-pad"
              />
              <FormTextField control={form.control} name="unit" label="Unit · optional" />
            </View>
          ) : null}
          {kind === 'task' ? (
            <View className="mb-3">
              <Text className="mb-2 text-sm font-medium text-ink">Choose task</Text>
              <View className="flex-row flex-wrap">
                {tasks
                  .filter((item) => item.status === 'pending')
                  .map((task) => (
                    <Chip
                      key={task.id}
                      label={task.title}
                      selected={form.watch('taskId') === task.id}
                      onPress={() => {
                        form.setValue('taskId', task.id, { shouldDirty: true });
                        form.setValue('title', form.getValues('title') || task.title);
                      }}
                    />
                  ))}
              </View>
            </View>
          ) : null}
          {kind === 'timer' ? (
            <FormTextField
              control={form.control}
              name="targetMinutes"
              label="Timer duration · minutes"
              keyboardType="number-pad"
              placeholder="25"
            />
          ) : null}
          {kind === 'quick_measurement' ? (
            <>
              <Text className="mb-2 text-sm font-medium text-ink">
                Saved quick-log preset · optional
              </Text>
              <View className="mb-2 flex-row flex-wrap">
                <Chip
                  label="Manual amount"
                  selected={!form.watch('presetId')}
                  onPress={() => {
                    form.setValue('presetId', '', { shouldDirty: true });
                    form.setValue('habitId', '', { shouldDirty: true });
                  }}
                />
                {presets.map((preset) => (
                  <Chip
                    key={preset.id}
                    label={`${preset.name} · ${preset.inputValue} ${preset.inputUnit}`}
                    selected={form.watch('presetId') === preset.id}
                    onPress={() => {
                      form.setValue('presetId', preset.id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('habitId', preset.habitId, { shouldDirty: true });
                      form.setValue('measurement', preset.measurement, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('value', String(preset.inputValue), {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('unit', preset.inputUnit, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      if (!form.getValues('title'))
                        form.setValue('title', preset.name, { shouldDirty: true });
                    }}
                  />
                ))}
              </View>
              <FormTextField
                control={form.control}
                name="measurement"
                label="Measurement"
                placeholder="duration, count, distance…"
              />
              <FormTextField
                control={form.control}
                name="value"
                label="Amount"
                keyboardType="decimal-pad"
              />
              <FormTextField
                control={form.control}
                name="unit"
                label="Unit"
                placeholder="minutes"
              />
            </>
          ) : null}
          <FormTextField control={form.control} name="note" label="Note · optional" multiline />
          <Chip
            label="Can skip this step"
            selected={form.watch('skippable')}
            onPress={() =>
              form.setValue('skippable', !form.getValues('skippable'), { shouldDirty: true })
            }
          />
          {Object.values(form.formState.errors).map((error, index) =>
            error?.message ? (
              <Text key={index} className="mb-2 text-sm text-red-700">
                {error.message}
              </Text>
            ) : null,
          )}
          <Button title="Save step" onPress={form.handleSubmit(onSave)} />
          <View className="mt-3">
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function RoutineDetailScreen() {
  const params = useLocalSearchParams<{ routineId?: string }>();
  const routineId = typeof params.routineId === 'string' ? params.routineId : '';
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const routine = useQuery({
    queryKey: ['routine', routineId],
    queryFn: () => getRoutine(routineId),
    enabled: !!routineId,
  });
  const history = useQuery({
    queryKey: ['routine', 'history', routineId],
    queryFn: () => getRoutineRunHistory(routineId),
    enabled: !!routineId,
  });
  const active = useQuery({
    queryKey: ['routine', 'active-run', routineId],
    queryFn: () => getActiveRoutineRun(routineId),
    enabled: !!routineId,
  });
  const archive = useMutation({
    mutationFn: () => archiveRoutine(routineId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['routines'] });
      showToast('Routine archived.', 'success');
      router.replace('/routines' as Href);
    },
    onError: () => showToast('Could not archive this routine.', 'error'),
  });
  if (routine.isLoading)
    return (
      <ScreenLayout>
        <Text className="mt-10 text-center text-slate-500">Loading routine…</Text>
      </ScreenLayout>
    );
  if (!routine.data)
    return (
      <ScreenLayout>
        <ErrorState
          message="Routine not found."
          onRetry={() => {
            void routine.refetch();
          }}
        />
      </ScreenLayout>
    );
  return (
    <ScreenLayout>
      <AppHeader
        title={routine.data.name}
        subtitle={routine.data.description || `${routine.data.steps.length} ordered steps`}
      />
      <View className="mt-4 gap-2">
        <Button
          title={active.data ? 'Resume routine' : 'Start routine'}
          onPress={() =>
            router.push(`/routines/run?routineId=${encodeURIComponent(routineId)}` as Href)
          }
        />
        <Button
          title="Edit routine"
          variant="secondary"
          onPress={() =>
            router.push(`/routines/edit?routineId=${encodeURIComponent(routineId)}` as Href)
          }
        />
        <Button
          title="Archive routine"
          variant="quiet"
          loading={archive.isPending}
          onPress={() =>
            Alert.alert('Archive this routine?', 'Run history stays available.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Archive', style: 'destructive', onPress: () => archive.mutate() },
            ])
          }
        />
      </View>
      <Text className="mb-2 mt-6 text-lg font-bold text-ink">Steps</Text>
      {routine.data.steps.map((step, index) => (
        <View key={step.id} className="mb-2 rounded-xl border border-slate-200 bg-white p-3">
          <Text className="font-semibold text-ink">
            {index + 1}. {step.title}
          </Text>
          <Text className="mt-1 text-sm capitalize text-slate-500">
            {step.kind.replaceAll('_', ' ')}
            {step.targetMinutes ? ` · ${step.targetMinutes} min` : ''}
          </Text>
        </View>
      ))}
      <Text className="mb-2 mt-6 text-lg font-bold text-ink">Recent runs</Text>
      {history.isLoading ? (
        <Text className="text-sm text-slate-500">Loading run history…</Text>
      ) : history.data?.length ? (
        history.data.slice(0, 20).map((run) => (
          <Pressable
            key={run.id}
            accessibilityRole="button"
            onPress={() => router.push(`/routines/run?runId=${encodeURIComponent(run.id)}` as Href)}
            className="mb-2 rounded-xl border border-slate-200 bg-white p-3"
          >
            <Text className="font-semibold text-ink">
              {run.localDate} · {run.status}
            </Text>
            <Text className="mt-1 text-sm text-slate-500">
              {run.progress.complete} completed · {run.progress.skipped} skipped ·{' '}
              {run.progress.percent}%
            </Text>
          </Pressable>
        ))
      ) : (
        <Text className="text-sm text-slate-500">No runs recorded yet.</Text>
      )}
    </ScreenLayout>
  );
}

export function RoutineRunScreen() {
  const params = useLocalSearchParams<{ routineId?: string; runId?: string }>();
  const routineId = typeof params.routineId === 'string' ? params.routineId : '';
  const runIdParam = typeof params.runId === 'string' ? params.runId : '';
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const routine = useQuery({
    queryKey: ['routine', routineId],
    queryFn: () => getRoutine(routineId),
    enabled: !!routineId && !runIdParam,
  });
  const active = useQuery({
    queryKey: ['routine', 'active-run', routineId],
    queryFn: () => getActiveRoutineRun(routineId),
    enabled: !!routineId && !runIdParam,
  });
  const runId = runIdParam || active.data?.id || '';
  const run = useQuery({
    queryKey: ['routine', 'run', runId],
    queryFn: () => getRoutineRun(runId),
    enabled: !!runId,
  });
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['routine'] });
    await client.invalidateQueries({ queryKey: ['routines'] });
  };
  const start = useMutation({
    mutationFn: () => startRoutineRun(routineId),
    onSuccess: async (id) => {
      await invalidate();
      router.replace(`/routines/run?runId=${encodeURIComponent(id)}` as Href);
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Could not start routine.', 'error'),
  });
  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'pause' | 'resume' | 'abandon' | 'finish' }) =>
      updateRoutineRun(id, verb),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Could not update routine run.', 'error'),
  });
  const stepAction = useMutation({
    mutationFn: ({ runId, stepId, skip }: { runId: string; stepId: string; skip: boolean }) =>
      skip ? skipRoutineStep(runId, stepId) : completeRoutineStep(runId, stepId),
    onSuccess: invalidate,
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Could not update step.', 'error'),
  });
  if ((runId && run.isLoading) || (!runId && routineId && active.isLoading))
    return (
      <ScreenLayout>
        <Text className="mt-10 text-center text-slate-500">Loading routine…</Text>
      </ScreenLayout>
    );
  if (!runId && routine.data)
    return (
      <ScreenLayout>
        <AppHeader
          title={routine.data.name}
          subtitle={`${routine.data.steps.length} steps · ${localDate}`}
        />
        <View className="mt-5 gap-3">
          {routine.data.steps.map((step, index) => (
            <Text
              key={step.id}
              className="rounded-xl border border-slate-200 bg-white p-4 text-ink"
            >
              {index + 1}. {step.title}
            </Text>
          ))}
          <Button title="Start routine" loading={start.isPending} onPress={() => start.mutate()} />
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </ScreenLayout>
    );
  if (!run.data)
    return (
      <ScreenLayout>
        <ErrorState
          message="Routine run not found. Return to routines and start a new run."
          onRetry={() => {
            void run.refetch();
          }}
        />
      </ScreenLayout>
    );
  const current = run.data.steps.find(
    (step) => step.status === 'pending' || step.status === 'in_progress',
  );
  return (
    <ScreenLayout>
      <AppHeader
        title={run.data.routineName}
        subtitle={`${run.data.progress.complete} complete · ${run.data.progress.skipped} skipped · ${run.data.progress.percent}%`}
      />
      <View className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <View className="h-2 bg-primary" style={{ width: `${run.data.progress.percent}%` }} />
      </View>
      <ScrollView className="mt-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {run.data.steps.map((step, index) => {
          const isCurrent = step.runStepId === current?.runStepId;
          return (
            <View
              key={step.runStepId}
              className={`mb-3 rounded-2xl border p-4 ${isCurrent ? 'border-primary bg-indigo-50' : 'border-slate-200 bg-white'}`}
            >
              <Text className="text-sm text-slate-500">
                Step {index + 1} · {step.status.replace('_', ' ')}
              </Text>
              <Text className="mt-1 text-lg font-bold text-ink">{step.title}</Text>
              {step.note ? <Text className="mt-1 text-sm text-slate-600">{step.note}</Text> : null}
              {isCurrent ? (
                <View className="mt-3 gap-2">
                  {step.kind === 'timer' ? (
                    <Button
                      title={`Start ${step.targetMinutes} min focus`}
                      onPress={() =>
                        router.push(
                          `/focus/setup?title=${encodeURIComponent(step.title)}&routineRunId=${encodeURIComponent(run.data!.id)}&routineStepRunId=${encodeURIComponent(step.runStepId)}&targetMinutes=${encodeURIComponent(step.targetMinutes)}&mode=countdown` as Href,
                        )
                      }
                    />
                  ) : (
                    <Button
                      title={
                        step.kind === 'task'
                          ? 'Complete task'
                          : step.kind === 'habit'
                            ? 'Log habit'
                            : 'Complete step'
                      }
                      loading={stepAction.isPending}
                      onPress={() =>
                        stepAction.mutate({
                          runId: run.data!.id,
                          stepId: step.runStepId,
                          skip: false,
                        })
                      }
                    />
                  )}
                  {step.skippable ? (
                    <Button
                      title="Skip"
                      variant="secondary"
                      loading={stepAction.isPending}
                      onPress={() =>
                        stepAction.mutate({
                          runId: run.data!.id,
                          stepId: step.runStepId,
                          skip: true,
                        })
                      }
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <View className="gap-2">
          <Button
            title={run.data.status === 'paused' ? 'Resume routine' : 'Pause routine'}
            variant="secondary"
            loading={action.isPending}
            onPress={() =>
              action.mutate({
                id: run.data!.id,
                verb: run.data!.status === 'paused' ? 'resume' : 'pause',
              })
            }
          />
          <Button
            title="Finish routine"
            disabled={!run.data.progress.canFinish}
            loading={action.isPending}
            onPress={() => action.mutate({ id: run.data!.id, verb: 'finish' })}
          />
          <Button
            title="Abandon run"
            variant="quiet"
            loading={action.isPending}
            onPress={() =>
              Alert.alert('Abandon this run?', 'Completed steps remain in history.', [
                { text: 'Keep going', style: 'cancel' },
                {
                  text: 'Abandon',
                  style: 'destructive',
                  onPress: () => action.mutate({ id: run.data!.id, verb: 'abandon' }),
                },
              ])
            }
          />
        </View>
      </ScrollView>
    </ScreenLayout>
  );
}
