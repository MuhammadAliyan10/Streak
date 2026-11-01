import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  AppState,
  Alert,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useToast } from '../../components/feedback/toast-provider';
import { AppHeader } from '../../components/layout/app-header';
import { Button, IconButton } from '../../components/ui/button';
import { FormTextField } from '../../components/ui/form-text-field';
import { getHabitForDate, listHabits } from '../habits/habit-repository';
import { measurementForHabit } from '../habits/domain/activity-domain';
import { todayInTimezone } from '../habits/domain/habit-domain';
import { getTask, getTasksForDate } from '../planner/planner-repository';
import {
  creditedDurationSchema,
  focusSetupSchema,
  formatDuration,
  remainingCountdown,
  type FocusSetup,
} from './focus-domain';
import {
  discardFocusSession,
  correctSavedFocusSession,
  deleteSavedFocusSession,
  finishFocusSession,
  focusElapsedMilliseconds,
  getCurrentFocusSession,
  getFocusSessionLogs,
  getFocusSession,
  pauseFocusSession,
  recordFocusAppState,
  resolveFocusRecovery,
  resetPausedFocusSession,
  resumeFocusSession,
  saveFocusSession,
  restoreSavedFocusSession,
  startFocusSession,
  type FocusSession,
} from './focus-repository';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
      className={`mr-2 mt-2 rounded-full border px-4 py-3 ${selected ? 'border-primary bg-indigo-50' : 'border-slate-200 bg-white'}`}
    >
      <Text className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-slate-700'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FocusSetupScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{
    habitId?: string;
    taskId?: string;
    title?: string;
    routineRunId?: string;
    routineStepRunId?: string;
    targetMinutes?: string;
    mode?: string;
  }>();
  const initialHabit = typeof params.habitId === 'string' ? params.habitId : '';
  const initialTask = typeof params.taskId === 'string' ? params.taskId : '';
  const form = useForm<FocusSetup>({
    resolver: zodResolver(focusSetupSchema),
    defaultValues: {
      title:
        typeof params.title === 'string' && params.title.length ? params.title : 'Focus session',
      mode: params.mode === 'countdown' || params.targetMinutes ? 'countdown' : 'stopwatch',
      targetMinutes: typeof params.targetMinutes === 'string' ? params.targetMinutes : '25',
      habitId: initialHabit,
      taskId: initialTask,
      note: '',
      timezone,
    },
  });
  const habitsQuery = useQuery({
    queryKey: ['focus', 'habits'],
    queryFn: () => listHabits('good'),
  });
  const tasksQuery = useQuery({
    queryKey: ['focus', 'tasks', todayInTimezone(timezone)],
    queryFn: () => getTasksForDate(todayInTimezone(timezone)),
  });
  const durationHabits = (habitsQuery.data ?? []).filter(
    (habit) =>
      habit.status === 'active' &&
      measurementForHabit(habit.measurement, habit.unit) === 'duration',
  );
  const availableTasks = (tasksQuery.data ?? []).filter((task) => task.status === 'pending');
  const mode = form.watch('mode');
  const habitId = form.watch('habitId');
  const taskId = form.watch('taskId');
  const selectedHabit = durationHabits.find((habit) => habit.id === habitId);
  const selectedTask = availableTasks.find((task) => task.id === taskId);
  const routineLink =
    typeof params.routineRunId === 'string' && typeof params.routineStepRunId === 'string'
      ? { routineRunId: params.routineRunId, routineStepRunId: params.routineStepRunId }
      : undefined;
  const startMutation = useMutation({
    mutationFn: (input: FocusSetup) => startFocusSession(input, routineLink),
    onSuccess: async (sessionId) => {
      await client.invalidateQueries({ queryKey: ['focus'] });
      router.replace(`/focus/session?sessionId=${encodeURIComponent(sessionId)}` as Href);
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : 'Could not start this session.', 'error'),
  });
  const setLink = (kind: 'habit' | 'task', id: string, title: string) => {
    form.setValue('title', title, { shouldDirty: true });
    form.setValue('habitId', kind === 'habit' ? id : '', { shouldDirty: true });
    form.setValue('taskId', kind === 'task' ? id : '', { shouldDirty: true });
  };
  return (
    <View className="flex-1 bg-canvas">
      <View className="px-6 pt-4">
        <AppHeader title="Start focus" subtitle="Choose what you want to work on." />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32 }}
      >
        <FormTextField
          control={form.control}
          name="title"
          label="Session title"
          placeholder="e.g. Study biology"
          autoCapitalize="sentences"
        />
        <Text className="mb-1 text-sm font-medium text-ink">Timer</Text>
        <View className="mb-5 flex-row flex-wrap">
          <Choice
            label="Stopwatch"
            selected={mode === 'stopwatch'}
            onPress={() => form.setValue('mode', 'stopwatch', { shouldValidate: true })}
          />
          <Choice
            label="Countdown"
            selected={mode === 'countdown'}
            onPress={() => form.setValue('mode', 'countdown', { shouldValidate: true })}
          />
        </View>
        {mode === 'countdown' ? (
          <>
            <Text className="mb-1 text-sm font-medium text-ink">Quick durations</Text>
            <View className="mb-3 flex-row flex-wrap">
              {[25, 45, 60].map((minutes) => (
                <Choice
                  key={minutes}
                  label={`${minutes} min`}
                  selected={form.watch('targetMinutes') === String(minutes)}
                  onPress={() =>
                    form.setValue('targetMinutes', String(minutes), { shouldValidate: true })
                  }
                />
              ))}
            </View>
            <FormTextField
              control={form.control}
              name="targetMinutes"
              label="Custom duration · minutes"
              placeholder="25"
              keyboardType="number-pad"
            />
          </>
        ) : null}
        <Text className="mb-1 text-sm font-semibold text-ink">
          Link to a habit or task · optional
        </Text>
        <Text className="mt-1 text-sm text-slate-500">
          Only duration habits receive progress credit. Timed tasks stay incomplete until you mark
          them done.
        </Text>
        <View className="mb-3 flex-row flex-wrap">
          <Choice
            label="Standalone"
            selected={!habitId && !taskId}
            onPress={() => {
              form.setValue('habitId', '');
              form.setValue('taskId', '');
            }}
          />
          {durationHabits.map((habit) => (
            <Choice
              key={habit.id}
              label={`Habit · ${habit.name}`}
              selected={habitId === habit.id}
              onPress={() => setLink('habit', habit.id, habit.name)}
            />
          ))}
          {availableTasks.map((task) => (
            <Choice
              key={task.id}
              label={`Task · ${task.title}`}
              selected={taskId === task.id}
              onPress={() => setLink('task', task.id, task.title)}
            />
          ))}
        </View>
        {form.formState.errors.targetMinutes?.message ? (
          <Text className="mb-3 text-sm text-red-700">
            {form.formState.errors.targetMinutes.message}
          </Text>
        ) : null}
        <FormTextField
          control={form.control}
          name="note"
          label="Notes · optional"
          placeholder="Anything to remember?"
          multiline
          numberOfLines={3}
          autoCapitalize="sentences"
        />
        <Button
          title="Start session"
          size="large"
          loading={startMutation.isPending}
          disabled={startMutation.isPending || !!(habitId && taskId)}
          onPress={form.handleSubmit((value) =>
            startMutation.mutateAsync(value).catch(() => undefined),
          )}
        />
        <View className="mt-3">
          <Button title="Cancel" variant="quiet" onPress={() => router.back()} />
        </View>
        {habitsQuery.isError || tasksQuery.isError ? (
          <Text className="mt-3 text-sm text-amber-800">
            Some habit or task links could not be loaded. A standalone session is still available.
          </Text>
        ) : null}
        {selectedHabit || selectedTask ? (
          <Text className="mt-3 text-xs text-slate-500">
            Linked to {selectedHabit?.name ?? selectedTask?.title}.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function FocusSessionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const client = useQueryClient();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  const [clock, setClock] = useState(Date.now());
  const allowNavigation = useRef(false);
  const creditForm = useForm({
    resolver: zodResolver(creditedDurationSchema),
    defaultValues: { minutes: '' },
    mode: 'onChange',
  });
  const creditedMinutes = creditForm.watch('minutes');
  const setCreditedMinutes = (value: string) =>
    creditForm.setValue('minutes', value, { shouldDirty: true, shouldValidate: true });
  const sessionQuery = useQuery({
    queryKey: ['focus', 'session', sessionId],
    queryFn: () => (sessionId ? getFocusSession(sessionId) : getCurrentFocusSession()),
    refetchInterval: false,
  });
  const session = sessionQuery.data;
  const active = !!session && ['running', 'paused', 'recovery', 'review'].includes(session.status);
  const leaveSession = useCallback(() => {
    Alert.alert(
      'Leave this session?',
      'The session will stay saved and its timer will continue. You can reopen it from Today.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Leave session open',
          style: 'destructive',
          onPress: () => {
            allowNavigation.current = true;
            router.back();
          },
        },
      ],
    );
  }, [router]);
  const sessionLocalDate = session
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: session.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(session.startedAt))
    : '';
  const relatedHabit = useQuery({
    queryKey: ['focus', 'habit-detail', session?.habitId, sessionLocalDate],
    queryFn: () => getHabitForDate(session!.habitId!, sessionLocalDate),
    enabled: !!session?.habitId,
  });
  const relatedTask = useQuery({
    queryKey: ['focus', 'task-detail', session?.taskId],
    queryFn: () => getTask(session!.taskId!),
    enabled: !!session?.taskId,
  });
  const sessionLogs = useQuery({
    queryKey: ['focus', 'logs', sessionId],
    queryFn: () => getFocusSessionLogs(sessionId),
    enabled: !!sessionId,
  });
  useEffect(() => {
    if (!active) return;
    return navigation.addListener('beforeRemove', (event) => {
      if (allowNavigation.current) {
        allowNavigation.current = false;
        return;
      }
      event.preventDefault();
      Alert.alert(
        'Leave this session?',
        'Your session will stay saved and can be reopened. Leaving does not stop its timer.',
        [
          { text: 'Stay here', style: 'cancel' },
          {
            text: 'Leave session open',
            style: 'destructive',
            onPress: () => {
              allowNavigation.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ],
      );
    });
  }, [active, navigation]);
  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveSession();
      return true;
    });
    return () => subscription.remove();
  }, [active, leaveSession]);
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    let wasInBackground = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      const nextIsBackground = state !== 'active';
      if (nextIsBackground === wasInBackground) return;
      wasInBackground = nextIsBackground;
      const transition = state === 'active' ? 'foregrounded' : 'backgrounded';
      void recordFocusAppState(session.id, transition).catch(() =>
        showToast('Could not record this app transition.', 'error'),
      );
    });
    return () => subscription.remove();
  }, [session?.id, session?.status, showToast]);
  const elapsedMs = useMemo(
    () => (session ? focusElapsedMilliseconds(session) : 0),
    [session, clock],
  );
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const remaining =
    session?.targetSeconds === null || session?.targetSeconds === undefined
      ? null
      : remainingCountdown(session.targetSeconds, elapsedMs);
  const invalidate = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ['focus'] });
    await client.invalidateQueries({ queryKey: ['habits'] });
    await client.invalidateQueries({ queryKey: ['planner'] });
    await client.invalidateQueries({ queryKey: ['activityLogs'] });
  }, [client]);
  const onError = async (error: unknown) => {
    showToast(
      error instanceof Error ? error.message : 'Could not update this session. Try again.',
      'error',
    );
    await client.invalidateQueries({ queryKey: ['focus', 'session', sessionId] });
  };
  const pauseMutation = useMutation({
    mutationFn: pauseFocusSession,
    onSuccess: invalidate,
    onError,
  });
  const resumeMutation = useMutation({
    mutationFn: resumeFocusSession,
    onSuccess: invalidate,
    onError,
  });
  const finishMutation = useMutation({
    mutationFn: finishFocusSession,
    onSuccess: async (_, finishedId) => {
      await invalidate();
      const saved = client.getQueryData<FocusSession | null>(['focus', 'session', finishedId]);
      creditForm.setValue(
        'minutes',
        ((saved ? Math.floor(saved.activeMs / 1000) : elapsedSeconds) / 60).toFixed(3),
        { shouldDirty: false, shouldValidate: true },
      );
    },
    onError,
  });
  const recoveryMutation = useMutation({
    mutationFn: ({ includeCandidate }: { includeCandidate: boolean }) =>
      resolveFocusRecovery(session!.id, includeCandidate),
    onSuccess: invalidate,
    onError,
  });
  const resetMutation = useMutation({
    mutationFn: resetPausedFocusSession,
    onSuccess: invalidate,
    onError,
  });
  const discardMutation = useMutation({
    mutationFn: discardFocusSession,
    onSuccess: async () => {
      await invalidate();
      showToast('Session discarded. No activity was recorded.', 'info');
      router.back();
    },
    onError,
  });
  const saveMutation = useMutation({
    mutationFn: ({ seconds }: { seconds: number }) => saveFocusSession(session!.id, seconds),
    onSuccess: async () => {
      await invalidate();
      showToast('Focus session saved.', 'success');
    },
    onError,
  });
  const correctMutation = useMutation({
    mutationFn: ({ seconds }: { seconds: number }) =>
      correctSavedFocusSession(session!.id, seconds),
    onSuccess: async () => {
      await invalidate();
      showToast('Session duration corrected.', 'success');
    },
    onError,
  });
  const deleteSavedMutation = useMutation({
    mutationFn: deleteSavedFocusSession,
    onSuccess: async () => {
      await invalidate();
      showToast('Session removed from activity history.', 'success');
    },
    onError,
  });
  const restoreSavedMutation = useMutation({
    mutationFn: restoreSavedFocusSession,
    onSuccess: async () => {
      await invalidate();
      showToast('Session restored to activity history.', 'success');
    },
    onError,
  });
  useEffect(() => {
    if (!session || session.status !== 'running' || session.targetSeconds === null) return;
    if (remaining === 0 && !finishMutation.isPending) finishMutation.mutate(session.id);
  }, [session?.id, session?.status, session?.targetSeconds, remaining, finishMutation.isPending]);
  useEffect(() => {
    if ((session?.status === 'review' || session?.status === 'completed') && creditedMinutes === '')
      setCreditedMinutes(
        ((session.creditedSeconds ?? Math.floor(session.activeMs / 1000)) / 60).toFixed(3),
      );
  }, [session?.status, session?.activeMs, session?.creditedSeconds, creditedMinutes, creditForm]);
  const busy =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    finishMutation.isPending ||
    recoveryMutation.isPending ||
    resetMutation.isPending ||
    discardMutation.isPending ||
    saveMutation.isPending ||
    correctMutation.isPending ||
    deleteSavedMutation.isPending ||
    restoreSavedMutation.isPending;
  if (sessionQuery.isLoading)
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <Text className="text-slate-600">Restoring session…</Text>
      </View>
    );
  if (sessionQuery.isError || !session)
    return (
      <View className="flex-1 justify-center bg-canvas px-6">
        <Text className="mb-4 text-center text-lg font-semibold text-ink">
          Focus session unavailable
        </Text>
        <Button title="Back to Today" onPress={() => router.replace('/today')} />
      </View>
    );

  const discard = () =>
    Alert.alert('Discard this session?', 'It will not add time to your activity history.', [
      { text: 'Keep session', style: 'cancel' },
      {
        text: 'Discard session',
        style: 'destructive',
        onPress: () => discardMutation.mutate(session.id),
      },
    ]);
  const finish = () =>
    Alert.alert('Finish session?', 'You can review the credited time before saving it.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', onPress: () => finishMutation.mutate(session.id) },
    ]);
  const creditedSchema = creditedDurationSchema.safeParse({ minutes: creditedMinutes });
  const creditedSeconds = creditedSchema.success ? Math.round(Number(creditedMinutes) * 60) : 0;
  const displayed = remaining === null ? elapsedMs : remaining * 1000;
  const progress = session.targetSeconds
    ? Math.min(1, elapsedMs / (session.targetSeconds * 1000))
    : 0;
  return (
    <View className="flex-1 bg-canvas px-6 pb-8 pt-5">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-4">
          <AppHeader
            title={session.title}
            subtitle={
              session.status === 'running'
                ? 'Focus session · running'
                : session.status === 'paused'
                  ? 'Paused'
                  : session.status === 'recovery'
                    ? 'Recovery needed'
                    : session.status === 'review'
                      ? 'Review before saving'
                      : session.status === 'discarded'
                        ? session.completedAt
                          ? 'Removed from history'
                          : 'Discarded'
                        : 'Session complete'
            }
          />
        </View>
        <IconButton
          icon={<Text className="text-lg text-slate-700">×</Text>}
          accessibilityLabel="Exit focus session"
          onPress={() => (active ? leaveSession() : router.back())}
        />
      </View>
      <View className="flex-1 items-center justify-center">
        {session.status === 'recovery' ? (
          <View className="mb-7 w-full rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <Text className="text-base font-semibold text-amber-950">
              Review time after restart
            </Text>
            <Text className="mt-2 text-sm text-amber-900">
              The app restarted while this session was active. Include the estimated{' '}
              {formatDuration(session.recoveryCandidateMs)} since the last save, or keep only the
              confirmed time.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                title="Include estimated time and pause"
                loading={recoveryMutation.isPending}
                onPress={() => recoveryMutation.mutate({ includeCandidate: true })}
              />
              <Button
                title="Keep confirmed time and pause"
                variant="secondary"
                loading={recoveryMutation.isPending}
                onPress={() => recoveryMutation.mutate({ includeCandidate: false })}
              />
            </View>
          </View>
        ) : null}
        {session.status !== 'recovery' ? (
          <>
            <Text className="mb-4 text-sm font-semibold uppercase tracking-[2px] text-primary">
              {session.status === 'running'
                ? 'FOCUS'
                : session.status === 'paused'
                  ? 'PAUSED'
                  : session.status === 'review'
                    ? 'REVIEW'
                    : 'COMPLETED'}
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              className="h-72 w-72 items-center justify-center rounded-full border-[10px] border-indigo-100 bg-white"
            >
              {session.mode === 'countdown'
                ? Array.from({ length: 60 }, (_, index) => {
                    const angle = (index / 60) * Math.PI * 2 - Math.PI / 2;
                    const radius = 132;
                    const size = 5;
                    return (
                      <View
                        key={index}
                        className={`absolute h-[5px] w-[5px] rounded-full ${index / 60 < progress ? 'bg-primary' : 'bg-indigo-100'}`}
                        style={{
                          left: 144 + radius * Math.cos(angle) - size / 2,
                          top: 144 + radius * Math.sin(angle) - size / 2,
                        }}
                      />
                    );
                  })
                : null}
              <Text className="text-5xl font-bold tabular-nums text-ink">
                {formatDuration(displayed)}
              </Text>
              {remaining !== null ? (
                <Text className="mt-3 text-sm text-slate-500">
                  {formatDuration(elapsedMs)} elapsed · {Math.round(progress * 100)}%
                </Text>
              ) : (
                <Text className="mt-3 text-sm text-slate-500">Time focused</Text>
              )}
            </View>
            {session.mode === 'countdown' ? (
              <View className="mt-6 h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                <View className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
              </View>
            ) : null}
            {session.status === 'review' ||
            session.status === 'completed' ||
            (session.status === 'discarded' && !!session.completedAt) ? (
              <View className="mt-8 w-full rounded-2xl border border-slate-200 bg-white p-4">
                <Text className="text-base font-semibold text-ink">Session summary</Text>
                <Text className="mt-2 text-sm text-slate-600">
                  Started {new Date(session.startedAt).toLocaleString()}
                </Text>
                {session.finishedAt ? (
                  <Text className="mt-1 text-sm text-slate-600">
                    Ended {new Date(session.finishedAt).toLocaleString()}
                  </Text>
                ) : null}
                <Text className="mt-1 text-sm text-slate-600">
                  Active time {formatDuration(session.activeMs)} · pauses{' '}
                  {formatDuration(
                    Math.max(
                      0,
                      new Date(session.finishedAt ?? new Date(clock).toISOString()).getTime() -
                        new Date(session.startedAt).getTime() -
                        session.activeMs,
                    ),
                  )}
                </Text>
                {session.habitId ? (
                  <Text className="mt-1 text-sm text-slate-600">
                    Habit · {relatedHabit.data?.name ?? 'unavailable'}
                  </Text>
                ) : null}
                {session.taskId ? (
                  <Text className="mt-1 text-sm text-slate-600">
                    Task · {relatedTask.data?.title ?? 'unavailable'} · task completion unchanged
                  </Text>
                ) : null}
                {sessionLogs.data?.some((log) => log.active) ? (
                  <Text className="mt-1 text-sm text-slate-600">
                    Logged on{' '}
                    {sessionLogs.data
                      .filter((log) => log.active)
                      .map((log) => log.localDate)
                      .join(', ')}
                  </Text>
                ) : null}
                {session.status === 'review' ? (
                  <>
                    <Text className="mb-2 mt-4 text-sm font-medium text-ink">
                      Credited duration · minutes
                    </Text>
                    <View className="flex-row items-center rounded-xl border border-slate-300 bg-white px-4">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reduce credited minutes"
                        onPress={() =>
                          setCreditedMinutes(
                            String(Math.max(0.01, Number(creditedMinutes || 0) - 1)),
                          )
                        }
                        className="min-h-12 justify-center px-3"
                      >
                        <Text className="text-xl text-primary">−</Text>
                      </Pressable>
                      <Controller
                        control={creditForm.control}
                        name="minutes"
                        render={({ field }) => (
                          <TextInput
                            ref={field.ref}
                            accessibilityLabel="Credited duration in minutes"
                            keyboardType="decimal-pad"
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            className="min-h-12 flex-1 text-center text-lg text-ink"
                          />
                        )}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add credited minute"
                        onPress={() =>
                          setCreditedMinutes(
                            String(Math.min(10080, Number(creditedMinutes || 0) + 1)),
                          )
                        }
                        className="min-h-12 justify-center px-3"
                      >
                        <Text className="text-xl text-primary">+</Text>
                      </Pressable>
                    </View>
                    {!creditedSchema.success ? (
                      <Text className="mt-1 text-sm text-red-700">
                        {creditedSchema.error.issues[0]?.message}
                      </Text>
                    ) : null}
                    <View className="mt-4 gap-3">
                      <Button
                        title="Save session"
                        loading={saveMutation.isPending}
                        disabled={busy || !creditedSchema.success}
                        onPress={() => saveMutation.mutate({ seconds: creditedSeconds })}
                      />
                      <Button
                        title="Discard without saving"
                        variant="quiet"
                        disabled={busy}
                        onPress={discard}
                      />
                    </View>
                  </>
                ) : session.status === 'completed' ? (
                  <>
                    <Text className="mt-3 text-sm font-semibold text-emerald-700">
                      Saved to activity history
                    </Text>
                    <Text className="mb-2 mt-4 text-sm font-medium text-ink">
                      Correct credited duration · minutes
                    </Text>
                    <View className="flex-row items-center rounded-xl border border-slate-300 bg-white px-4">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reduce credited minutes"
                        onPress={() =>
                          setCreditedMinutes(
                            String(Math.max(0.01, Number(creditedMinutes || 0) - 1)),
                          )
                        }
                        className="min-h-12 justify-center px-3"
                      >
                        <Text className="text-xl text-primary">−</Text>
                      </Pressable>
                      <Controller
                        control={creditForm.control}
                        name="minutes"
                        render={({ field }) => (
                          <TextInput
                            ref={field.ref}
                            accessibilityLabel="Corrected duration in minutes"
                            keyboardType="decimal-pad"
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            className="min-h-12 flex-1 text-center text-lg text-ink"
                          />
                        )}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add credited minute"
                        onPress={() =>
                          setCreditedMinutes(
                            String(Math.min(10080, Number(creditedMinutes || 0) + 1)),
                          )
                        }
                        className="min-h-12 justify-center px-3"
                      >
                        <Text className="text-xl text-primary">+</Text>
                      </Pressable>
                    </View>
                    {!creditedSchema.success ? (
                      <Text className="mt-1 text-sm text-red-700">
                        {creditedSchema.error.issues[0]?.message}
                      </Text>
                    ) : null}
                    <View className="mt-4 gap-3">
                      <Button
                        title="Save duration correction"
                        variant="secondary"
                        loading={correctMutation.isPending}
                        disabled={
                          busy ||
                          !creditedSchema.success ||
                          creditedSeconds === session.creditedSeconds
                        }
                        onPress={() => correctMutation.mutate({ seconds: creditedSeconds })}
                      />
                      <Button
                        title="Remove saved session"
                        variant="quiet"
                        disabled={busy}
                        onPress={() =>
                          Alert.alert(
                            'Remove this session?',
                            'Its linked activity logs will be removed and can be restored together.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove session',
                                style: 'destructive',
                                onPress: () => deleteSavedMutation.mutate(session.id),
                              },
                            ],
                          )
                        }
                      />
                    </View>
                  </>
                ) : session.completedAt ? (
                  <View className="mt-4">
                    <Button
                      title="Restore saved session"
                      variant="secondary"
                      loading={restoreSavedMutation.isPending}
                      onPress={() => restoreSavedMutation.mutate(session.id)}
                    />
                  </View>
                ) : (
                  <Text className="mt-2 text-sm font-semibold text-emerald-700">
                    Discarded · no activity was recorded
                  </Text>
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      {session.status === 'running' ? (
        <View className="gap-3">
          <Button
            title="Pause"
            size="large"
            loading={pauseMutation.isPending}
            disabled={busy}
            onPress={() => pauseMutation.mutate(session.id)}
          />
          <Button
            title="Finish and review"
            variant="secondary"
            loading={finishMutation.isPending}
            disabled={busy}
            onPress={finish}
          />
          <Button title="Exit session" variant="quiet" disabled={busy} onPress={leaveSession} />
        </View>
      ) : null}
      {session.status === 'paused' ? (
        <View className="gap-3">
          <Button
            title="Resume"
            size="large"
            loading={resumeMutation.isPending}
            disabled={busy}
            onPress={() => resumeMutation.mutate(session.id)}
          />
          <Button
            title="Finish and review"
            variant="secondary"
            loading={finishMutation.isPending}
            disabled={busy}
            onPress={() => finishMutation.mutate(session.id)}
          />
          <Button
            title="Reset timer"
            variant="secondary"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Reset this timer?',
                'Confirmed time will be cleared. No activity has been recorded yet.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reset timer',
                    style: 'destructive',
                    onPress: () => resetMutation.mutate(session.id),
                  },
                ],
              )
            }
          />
          <Button title="Discard session" variant="quiet" disabled={busy} onPress={discard} />
        </View>
      ) : null}
      {session.status === 'completed' ? (
        <Button title="Back to Today" onPress={() => router.replace('/today')} />
      ) : null}
    </View>
  );
}
