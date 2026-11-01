import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { z } from 'zod';
import { useToast } from '../../components/feedback/toast-provider';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { AppIcon } from '../../components/ui/app-icon';
import { Button, IconButton } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { FormTextField } from '../../components/ui/form-text-field';
import { useAuth } from '../auth/auth-context';
import {
  addHabitEntry,
  createActivityLog,
  deleteActivityLog,
  getActivityLogsForDate,
  getPresetsForHabits,
  getBuiltInDigitalPresets,
  listHabits,
  newActivityKey,
  restoreActivityLog,
  recordDigitalUsageTotal,
  updateActivityLog,
  type ActivityEntry,
  type HabitRecord,
} from '../habits/habit-repository';
import { dateAdd, todayInTimezone } from '../habits/domain/habit-domain';
import { HabitNavigation, habitHref } from '../habits/habit-navigation';
import { syncEnabledWalkingSnapshots } from '../habits/walking-tracking';
import { formatGoalTarget, getGoals } from '../goals-routines/goal-repository';
import { getRoutinesForDate } from '../goals-routines/routine-repository';
import { measurementForHabit } from '../habits/domain/activity-domain';
import { getCurrentFocusSession } from '../focus/focus-repository';
import { HabitCard, ProgressModal } from '../habits/habit-screens';
import {
  ActivityLogRow,
  ActivityLogSheet,
  PresetManagerSheet,
} from '../habits/activity-components';
import {
  applyTaskAction,
  getDailyReview,
  getDeletedTasksForDate,
  getTaskEventsForDate,
  getTasksForDate,
  saveDailyReview,
  type DailyReviewInput,
  type PlannerTask,
  type TaskEvent,
} from './planner-repository';
import {
  getDailyReviewFacts,
  getRoutineEventsForDate,
  type RoutineDayEvent,
} from '../insights/insights-repository';
import {
  dayCounts,
  formatPlannerDate,
  localTimeAt,
  sortTimeline,
  type TimelineItem,
} from './planner-domain';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const reviewSchema = z.object({
  wentWell: z.string().trim().max(1000, 'Keep this under 1,000 characters.'),
  improve: z.string().trim().max(1000, 'Keep this under 1,000 characters.'),
  tomorrowPriority: z.string().trim().max(500, 'Keep this under 500 characters.'),
});
type ReviewForm = z.infer<typeof reviewSchema>;
function SectionTitle({ title, action }: { title: string; action?: import('react').ReactNode }) {
  return (
    <View className="mb-3 mt-7 flex-row items-center justify-between">
      <Text accessibilityRole="header" className="text-lg font-bold text-ink">
        {title}
      </Text>
      {action}
    </View>
  );
}
function Card({ children }: PropsWithChildren) {
  return <View className="rounded-2xl border border-slate-200 bg-white p-4">{children}</View>;
}
function DateChooser({
  date,
  onChange,
  onClose,
}: {
  date: string;
  onChange: (date: string) => void;
  onClose: () => void;
}) {
  const [value] = date.split('-').map(Number);
  const selected = value
    ? new Date(value, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12)
    : new Date();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <View className="rounded-t-3xl bg-white p-5">
          <Text className="mb-3 text-lg font-bold text-ink">Choose a day</Text>
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
  );
}
function ReviewModal({
  visible,
  date,
  initialReview,
  onClose,
  onSave,
}: {
  visible: boolean;
  date: string;
  initialReview: DailyReviewInput;
  onClose: () => void;
  onSave: (input: DailyReviewInput) => Promise<void>;
}) {
  const form = useForm<ReviewForm>({
    resolver: zodResolver(reviewSchema),
    defaultValues: initialReview,
  });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-slate-900/40">
        <KeyboardAvoidingView
          className="flex-1 justify-end"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
          >
            <View className="rounded-t-3xl bg-canvas p-5">
              <Text accessibilityRole="header" className="mb-1 text-xl font-bold text-ink">
                Review your day
              </Text>
              <Text className="mb-5 text-sm text-slate-600">
                {formatPlannerDate(date, timezone)}
              </Text>
              <FormTextField
                control={form.control}
                name="wentWell"
                label="What went well? · optional"
                placeholder="A small win or something you appreciated"
                multiline
                numberOfLines={3}
                autoCapitalize="sentences"
              />
              <FormTextField
                control={form.control}
                name="improve"
                label="What could improve? · optional"
                placeholder="One thing to adjust next time"
                multiline
                numberOfLines={3}
                autoCapitalize="sentences"
              />
              <FormTextField
                control={form.control}
                name="tomorrowPriority"
                label="Tomorrow's priority · optional"
                placeholder="One thing to focus on"
                multiline
                numberOfLines={2}
                autoCapitalize="sentences"
              />
              <View className="gap-3">
                <Button
                  title="Save review"
                  loading={form.formState.isSubmitting}
                  disabled={form.formState.isSubmitting}
                  onPress={form.handleSubmit(async (value) => {
                    try {
                      await onSave(value);
                      onClose();
                    } catch {
                      form.setError('wentWell', {
                        type: 'server',
                        message: 'Could not save the review. Try again.',
                      });
                    }
                  })}
                />
                <Button title="Cancel" variant="secondary" onPress={onClose} />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
function taskStatusLabel(task: PlannerTask) {
  return task.status === 'completed'
    ? 'Completed'
    : task.status === 'cancelled'
      ? 'Cancelled'
      : 'Planned';
}
function taskEventLabel(event: TaskEvent): string {
  const labels: Record<string, string> = {
    created: 'Task added',
    edited: 'Task updated',
    completed: 'Task completed',
    reopened: 'Task reopened',
    rescheduled: 'Task rescheduled',
    cancelled: 'Task cancelled',
    deleted: 'Task deleted',
    restored: 'Task restored',
  };
  return labels[event.eventType] ?? 'Task changed';
}
function buildTimeline(
  habits: HabitRecord[],
  tasks: PlannerTask[],
  entries: Awaited<ReturnType<typeof getActivityLogsForDate>>,
  events: TaskEvent[],
  routineEvents: RoutineDayEvent[],
): TimelineItem[] {
  const scheduled: TimelineItem[] = habits
    .filter((habit) => !['unscheduled', 'paused'].includes(habit.todayState))
    .map((habit) => ({
      id: `planned-habit:${habit.id}`,
      title: habit.name,
      detail:
        habit.scheduleMode === 'flexible'
          ? `Habit · ${habit.windowStart ?? ''}–${habit.windowEnd ?? ''}`
          : 'Habit · planned',
      time:
        habit.scheduleMode === 'fixed'
          ? habit.fixedTime
          : habit.scheduleMode === 'flexible'
            ? habit.windowStart
            : null,
      kind: 'planned',
      status: ['completed', 'clean'].includes(habit.todayState)
        ? 'completed'
        : habit.todayState === 'missed'
          ? 'missed'
          : habit.todayState === 'incident'
            ? 'missed'
            : 'pending',
    }));
  const plannedTasks: TimelineItem[] = tasks.map((task) => ({
    id: `planned-task:${task.id}`,
    title: task.title,
    detail: `Task · ${taskStatusLabel(task)}`,
    time: task.plannedTime,
    kind: 'planned',
    status:
      task.status === 'completed'
        ? 'completed'
        : task.status === 'cancelled'
          ? 'cancelled'
          : 'pending',
  }));
  const actualHabits: TimelineItem[] = entries
    .filter((entry) => !entry.deleted_at)
    .map((entry) => ({
      id: `actual:${entry.id}`,
      title: entry.habit_name ?? (entry.title || entry.category),
      detail: `${entry.input_value !== null ? `${entry.input_value} ${entry.input_unit ?? ''}` : entry.kind.replaceAll('_', ' ')} · ${entry.value_mode === 'daily_total' ? 'self-reported daily total' : 'manually recorded'}${entry.preset_name ? ` · ${entry.preset_name}` : ''}${entry.correction_count ? ` · corrected ${entry.correction_count} times` : ''}${entry.note ? ` · ${entry.note}` : ''}`,
      time: localTimeAt(entry.occurred_at, entry.timezone),
      kind: 'actual',
      status:
        entry.kind === 'occurrence' ? 'missed' : entry.kind === 'skip' ? 'cancelled' : 'recorded',
    }));
  const changes: TimelineItem[] = events.map((event) => ({
    id: `change:${event.id}`,
    title: event.taskTitle,
    detail: taskEventLabel(event),
    time: localTimeAt(event.occurredAt, event.timezone),
    kind: 'change',
    status:
      event.eventType === 'completed'
        ? 'completed'
        : event.eventType === 'cancelled' || event.eventType === 'deleted'
          ? 'cancelled'
          : 'recorded',
  }));
  const routines: TimelineItem[] = routineEvents.map((event) => ({
    id: `routine:${event.id}`,
    title: event.name,
    detail: `Routine ${event.status === 'completed' ? 'completed' : event.status === 'abandoned' ? 'abandoned' : event.status}`,
    time: localTimeAt(event.startedAt, event.timezone),
    kind: 'change',
    status:
      event.status === 'completed'
        ? 'completed'
        : event.status === 'abandoned'
          ? 'cancelled'
          : 'recorded',
  }));
  return sortTimeline([...scheduled, ...plannedTasks, ...actualHabits, ...changes, ...routines]);
}

export function TodayScreen() {
  const { status, signOut } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const today = todayInTimezone(timezone);
  const [date, setDate] = useState(today);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<HabitRecord | null>(null);
  const [dailyTotalHabit, setDailyTotalHabit] = useState<HabitRecord | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ActivityEntry | null>(null);
  const [presetHabit, setPresetHabit] = useState<HabitRecord | null>(null);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [lastLoggedId, setLastLoggedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const historical = date !== today;
  const habits = useQuery({
    queryKey: ['habits', 'day', date],
    queryFn: async () => {
      if (!historical) await syncEnabledWalkingSnapshots(date);
      return listHabits('all', true, date);
    },
  });
  const presets = useQuery({
    queryKey: ['activityPresets', (habits.data ?? []).map((habit) => habit.id).join(',')],
    queryFn: () => getPresetsForHabits((habits.data ?? []).map((habit) => habit.id)),
    enabled: !!habits.data?.length,
  });
  const tasks = useQuery({
    queryKey: ['planner', 'tasks', date],
    queryFn: () => getTasksForDate(date),
  });
  const deleted = useQuery({
    queryKey: ['planner', 'deleted', date],
    queryFn: () => getDeletedTasksForDate(date),
  });
  const entries = useQuery({
    queryKey: ['planner', 'habitEntries', date],
    queryFn: () => getActivityLogsForDate(date, true),
  });
  const events = useQuery({
    queryKey: ['planner', 'taskEvents', date],
    queryFn: () => getTaskEventsForDate(date),
  });
  const review = useQuery({
    queryKey: ['planner', 'review', date],
    queryFn: () => getDailyReview(date),
  });
  const reviewFacts = useQuery({
    queryKey: ['planner', 'reviewFacts', date],
    queryFn: () => getDailyReviewFacts(date),
  });
  const routineEvents = useQuery({
    queryKey: ['planner', 'routineEvents', date],
    queryFn: () => getRoutineEventsForDate(date),
  });
  const currentFocus = useQuery({
    queryKey: ['focus', 'current'],
    queryFn: getCurrentFocusSession,
  });
  const goals = useQuery({
    queryKey: ['goals', 'today', date],
    queryFn: async () => {
      if (!historical) await syncEnabledWalkingSnapshots(date);
      return getGoals({ localDate: date });
    },
    enabled: true,
  });
  const routines = useQuery({
    queryKey: ['routines', 'today', date],
    queryFn: () => getRoutinesForDate(date),
    enabled: true,
  });
  const taskMutation = useMutation({
    mutationFn: ({
      taskId,
      action,
    }: {
      taskId: string;
      action: 'complete' | 'reopen' | 'cancel' | 'delete' | 'restore';
    }) => applyTaskAction(taskId, action),
    onSuccess: async (_, variables) => {
      await client.invalidateQueries({ queryKey: ['planner'] });
      showToast(
        variables.action === 'complete'
          ? 'Task completed.'
          : variables.action === 'restore'
            ? 'Task restored.'
            : variables.action === 'delete'
              ? 'Task moved to Recently deleted.'
              : variables.action === 'cancel'
                ? 'Task cancelled.'
                : 'Task reopened.',
        'success',
      );
    },
    onError: () => showToast('Could not update the task. Try again.', 'error'),
  });
  const habitMutation = useMutation({
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
      showToast('Habit check-in saved.', 'success');
    },
    onError: () => showToast('Could not save this check-in. Try again.', 'error'),
  });
  const activityMutation = useMutation({
    mutationFn: createActivityLog,
    onSuccess: async (id) => {
      setLastLoggedId(id);
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Activity logged.', 'success');
    },
    onError: () => showToast('Could not log this activity. Try again.', 'error'),
  });
  const editActivityMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateActivityLog>[1] }) =>
      updateActivityLog(id, input),
    onSuccess: async () => {
      setSelectedEntry(null);
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Activity corrected.', 'success');
    },
    onError: () => showToast('Could not correct this activity. Try again.', 'error'),
  });
  const deleteActivityMutation = useMutation({
    mutationFn: deleteActivityLog,
    onSuccess: async () => {
      setLastLoggedId(null);
      setSelectedEntry(null);
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Activity removed. You can restore it from Removed entries.', 'success');
    },
    onError: () => showToast('Could not remove this activity.', 'error'),
  });
  const restoreActivityMutation = useMutation({
    mutationFn: restoreActivityLog,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['habits'] });
      await client.invalidateQueries({ queryKey: ['planner'] });
      await client.invalidateQueries({ queryKey: ['activityLogs'] });
      showToast('Activity restored.', 'success');
    },
    onError: () => showToast('Could not restore this activity.', 'error'),
  });
  const reviewMutation = useMutation({
    mutationFn: (input: DailyReviewInput) => saveDailyReview(date, timezone, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['planner', 'review', date] });
      showToast('Daily review saved.', 'success');
    },
    onError: () => showToast('Could not save your review. Try again.', 'error'),
  });
  const counts = dayCounts(tasks.data ?? []);
  const scheduledHabits = (habits.data ?? []).filter(
    (habit) =>
      !['unscheduled', 'paused'].includes(habit.todayState) &&
      (historical || habit.status !== 'archived'),
  );
  const recentActivityByHabit = new Map<string, string>();
  for (const entry of entries.data ?? []) {
    if (entry.habit_id && !entry.deleted_at) {
      const amount =
        entry.input_value !== null
          ? `${entry.input_value} ${entry.input_unit ?? ''}`
          : entry.kind.replaceAll('_', ' ');
      recentActivityByHabit.set(
        entry.habit_id,
        `${amount} at ${localTimeAt(entry.occurred_at, entry.timezone)}`,
      );
    }
  }
  const doneHabits = scheduledHabits.filter((habit) =>
    ['completed', 'clean'].includes(habit.todayState),
  ).length;
  const currentLocalTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const nextActivities = useMemo(
    () =>
      [
        ...scheduledHabits
          .filter((habit) => habit.scheduleMode !== 'anytime')
          .map((habit) => ({
            id: habit.id,
            title: habit.name,
            time: habit.scheduleMode === 'fixed' ? habit.fixedTime : habit.windowStart,
            detail: 'Habit',
          })),
        ...(tasks.data ?? [])
          .filter((task) => task.status === 'pending' && task.plannedTime)
          .map((task) => ({
            id: task.id,
            title: task.title,
            time: task.plannedTime,
            detail: 'Task',
          })),
      ]
        .filter((activity) => historical || (!!activity.time && activity.time >= currentLocalTime))
        .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
    [currentLocalTime, historical, scheduledHabits, tasks.data],
  );
  const timeline = buildTimeline(
    habits.data ?? [],
    tasks.data ?? [],
    (entries.data ?? []).filter((entry) => !entry.deleted_at),
    events.data ?? [],
    routineEvents.data ?? [],
  );
  const selectedEntryHabit = selectedEntry?.habit_id
    ? ((habits.data ?? []).find((habit) => habit.id === selectedEntry.habit_id) ?? null)
    : null;
  if (status === 'loading')
    return (
      <ScreenLayout>
        <Text className="py-10 text-center text-slate-600">Loading your day…</Text>
      </ScreenLayout>
    );
  if (status !== 'authenticated') return <Redirect href="/" />;
  const changeTask = (task: PlannerTask) => {
    if (historical || taskMutation.isPending) return;
    if (task.status === 'pending')
      Alert.alert(task.title, 'Choose an action for this task.', [
        {
          text: 'Complete',
          onPress: () => taskMutation.mutate({ taskId: task.id, action: 'complete' }),
        },
        {
          text: 'Cancel task',
          style: 'destructive',
          onPress: () => taskMutation.mutate({ taskId: task.id, action: 'cancel' }),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Move to Recently deleted?',
              'You can restore this task from this screen.',
              [
                { text: 'Keep task', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => taskMutation.mutate({ taskId: task.id, action: 'delete' }),
                },
              ],
            ),
        },
        { text: 'Edit', onPress: () => router.push(habitHref(`/tasks/${task.id}/edit`)) },
        { text: 'Close', style: 'cancel' },
      ]);
    else
      Alert.alert(
        task.title,
        task.status === 'completed' ? 'This task is complete.' : 'This task is cancelled.',
        [
          ...(task.status === 'completed'
            ? [
                {
                  text: 'Reopen',
                  onPress: () => taskMutation.mutate({ taskId: task.id, action: 'reopen' }),
                },
              ]
            : []),
          { text: 'Edit', onPress: () => router.push(habitHref(`/tasks/${task.id}/edit`)) },
          { text: 'Close', style: 'cancel' },
        ],
      );
  };
  const logout = async () => {
    setSigningOut(true);
    try {
      const revoked = await signOut();
      showToast(
        revoked ? 'Signed out.' : 'Signed out on this device. Server revocation is pending.',
        revoked ? 'success' : 'info',
      );
    } catch {
      showToast('Could not clear the saved session. Try again.', 'error');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScreenLayout
      bottomNavigation={<HabitNavigation selected="today" />}
      header={{
        title: 'Today',
        subtitle: formatPlannerDate(date, timezone),
        action: (
          <View className="flex-row gap-2">
            <IconButton
              accessibilityLabel="Reminder settings"
              accessibilityHint="Manage local notifications and reminder times."
              icon={<AppIcon name="settings" size={21} color="#334155" />}
              onPress={() => router.push('/notifications' as Href)}
            />
            <IconButton
              accessibilityLabel="Choose date"
              accessibilityHint="Open the calendar to view another day."
              icon={<AppIcon name="calendar" size={21} color="#334155" />}
              onPress={() => setShowDatePicker(true)}
            />
            <IconButton
              accessibilityLabel="Insights"
              accessibilityHint="Review trends from your recorded activity."
              icon={<AppIcon name="chart" size={21} color="#334155" />}
              onPress={() => router.push('/insights' as Href)}
            />
          </View>
        ),
      }}
    >
      <View className="mb-1 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-2">
        <IconButton
          accessibilityLabel="Previous day"
          icon={<AppIcon name="chevronLeft" />}
          onPress={() => setDate((current) => dateAdd(current, -1))}
          variant="quiet"
        />
        <Text className="flex-1 text-center text-sm font-semibold text-ink">
          {date === today ? 'Today' : date}
        </Text>
        <IconButton
          accessibilityLabel="Next day"
          icon={<AppIcon name="chevronRight" />}
          onPress={() => setDate((current) => dateAdd(current, 1))}
          variant="quiet"
        />
        {historical ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDate(today)}
            className="min-h-11 justify-center px-2"
          >
            <Text className="text-sm font-semibold text-primary">Today</Text>
          </Pressable>
        ) : null}
      </View>
      <SectionTitle title="Overview" />
      {currentFocus.data ? (
        <View className="mb-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <Text className="text-base font-semibold text-ink">{currentFocus.data.title}</Text>
          <Text className="mt-1 text-sm text-slate-600">
            {currentFocus.data.status === 'running'
              ? 'Focus session is running.'
              : currentFocus.data.status === 'paused'
                ? 'Focus session paused.'
                : currentFocus.data.status === 'recovery'
                  ? 'Review the session time after restart.'
                  : 'Review and save your completed session.'}
          </Text>
          <View className="mt-3">
            <Button
              title={
                currentFocus.data.status === 'review' ? 'Review session' : 'Open focus session'
              }
              onPress={() =>
                router.push(
                  habitHref(
                    `/focus/session?sessionId=${encodeURIComponent(currentFocus.data!.id)}`,
                  ),
                )
              }
            />
          </View>
        </View>
      ) : null}
      <View className="flex-row gap-3">
        <Card>
          <Text className="text-2xl font-bold text-ink">
            {doneHabits}/{scheduledHabits.length}
          </Text>
          <Text className="mt-1 text-xs text-slate-600">Habits done</Text>
        </Card>
        <Card>
          <Text className="text-2xl font-bold text-ink">{counts.pending}</Text>
          <Text className="mt-1 text-xs text-slate-600">Tasks pending</Text>
        </Card>
        <Card>
          <Text className="text-2xl font-bold text-ink">{counts.completed}</Text>
          <Text className="mt-1 text-xs text-slate-600">Tasks done</Text>
        </Card>
      </View>
      <View className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
        <Text className="text-sm font-semibold text-primary">Streaks</Text>
        <Text className="mt-1 text-sm text-slate-700">
          {scheduledHabits.length
            ? `${Math.max(...scheduledHabits.map((habit) => habit.streak.current))} day longest current streak`
            : 'Create a habit to begin a streak.'}
        </Text>
      </View>
      {!historical ? (
        <>
          <SectionTitle title="Goals and routines" />
          <View className="mb-3 flex-row gap-3">
            <View className="flex-1">
              <Button
                title="View goals"
                variant="secondary"
                onPress={() => router.push(habitHref('/goals'))}
              />
            </View>
            <View className="flex-1">
              <Button
                title="View routines"
                variant="secondary"
                onPress={() => router.push(habitHref('/routines'))}
              />
            </View>
          </View>
          {(goals.data ?? [])
            .filter((goal) => goal.status === 'active')
            .slice(0, 3)
            .map((goal) => (
              <Pressable
                key={goal.id}
                accessibilityRole="button"
                onPress={() => router.push(habitHref(`/goals/${goal.id}`))}
                className="mb-2 rounded-xl border border-slate-200 bg-white p-3"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-ink">{goal.title}</Text>
                  <Text className="font-semibold text-primary">
                    {goal.progress.progressPercent}%
                  </Text>
                </View>
                <Text className="mt-1 text-sm text-slate-500">
                  {goal.model === 'recurring'
                    ? `${goal.progress.achievedPeriods}/${goal.progress.elapsedPeriods} periods · ${goal.progress.missedPeriods} missed`
                    : `${goal.progress.totalValue.toFixed(1)} / ${formatGoalTarget(goal)}`}
                </Text>
              </Pressable>
            ))}
          {(routines.data ?? []).slice(0, 3).map((routine) => (
            <View
              key={routine.id}
              className="mb-2 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white p-3"
            >
              <View className="mr-3 flex-1">
                <Text className="font-semibold text-ink">{routine.name}</Text>
                <Text className="mt-1 text-sm text-slate-500">
                  {routine.steps.length} steps{routine.startTime ? ` · ${routine.startTime}` : ''}
                </Text>
              </View>
              <Button
                title={routine.activeRunId ? 'Resume' : 'Start'}
                fullWidth={false}
                onPress={() =>
                  router.push(
                    habitHref(`/routines/run?routineId=${encodeURIComponent(routine.id)}`),
                  )
                }
              />
            </View>
          ))}
          {!goals.data?.some((goal) => goal.status === 'active') && !routines.data?.length ? (
            <Text className="mb-2 text-sm text-slate-500">
              No goals or routines need attention today.
            </Text>
          ) : null}
        </>
      ) : null}

      <SectionTitle
        title="Upcoming activities"
        action={
          !historical ? (
            <View className="flex-row gap-2">
              <Button
                title="Start focus"
                fullWidth={false}
                onPress={() => router.push(habitHref('/focus/setup'))}
              />
              <Button
                title="Quick log"
                fullWidth={false}
                variant="secondary"
                onPress={() => setQuickLogOpen(true)}
              />
            </View>
          ) : null
        }
      />
      {nextActivities.length ? (
        <Card>
          {nextActivities.map((activity, index) => (
            <View
              key={`${activity.detail}:${activity.id}`}
              className={`flex-row items-center py-2 ${index ? 'border-t border-slate-100' : ''}`}
            >
              <AppIcon name="clock" size={17} color="#64748B" />
              <Text className="ml-2 w-14 text-sm font-medium text-slate-600">
                {activity.time ?? 'Anytime'}
              </Text>
              <Text className="flex-1 text-sm font-semibold text-ink">{activity.title}</Text>
              <Text className="text-xs text-slate-500">{activity.detail}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Nothing scheduled"
          message="Add a task time or set a habit schedule to see what is coming up."
        />
      )}

      <SectionTitle title="Habits" />
      {habits.isError ? (
        <ErrorState
          message="Your habits could not be loaded."
          onRetry={() => void habits.refetch()}
        />
      ) : scheduledHabits.length ? (
        scheduledHabits.map((habit) => (
          <HabitCard
            key={habit.id}
            habit={habit}
            actionEnabled={!historical}
            loading={habitMutation.isPending}
            onOpen={() => router.push(habitHref(`/habits/${habit.id}`))}
            onQuick={() =>
              habitMutation.mutate({
                habit,
                kind: habit.kind === 'bad' ? 'clean' : 'complete_override',
              })
            }
            onOccurrence={() => habitMutation.mutate({ habit, kind: 'occurrence' })}
            onProgress={() => setSelectedHabit(habit)}
            onDailyTotal={() => setDailyTotalHabit(habit)}
            presets={(() => {
              const saved = (presets.data ?? []).filter(
                (preset) =>
                  preset.habitId === habit.id &&
                  preset.measurement === measurementForHabit(habit.measurement, habit.unit),
              );
              return saved.length ? saved : getBuiltInDigitalPresets(habit);
            })()}
            onPreset={(preset) =>
              activityMutation.mutate({
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
              })
            }
            onManagePresets={() => setPresetHabit(habit)}
            recentActivity={recentActivityByHabit.get(habit.id)}
          />
        ))
      ) : (
        <EmptyState
          title="No habits planned"
          message="Create a habit and it will appear here on its scheduled days."
        />
      )}

      <SectionTitle
        title="Tasks"
        action={
          !historical ? (
            <Button
              title="Add task"
              fullWidth={false}
              size="regular"
              leftIcon={<AppIcon name="plus" size={18} color="#FFFFFF" />}
              onPress={() => router.push(habitHref('/tasks/new'))}
            />
          ) : null
        }
      />
      {tasks.isError ? (
        <ErrorState
          message="Your tasks could not be loaded."
          onRetry={() => void tasks.refetch()}
        />
      ) : tasks.data?.length ? (
        tasks.data.map((task) => (
          <View key={task.id} className="mb-2 rounded-2xl border border-slate-200 bg-white p-4">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${task.title}, ${taskStatusLabel(task)}. Open task actions.`}
              disabled={historical || taskMutation.isPending}
              onPress={() => changeTask(task)}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text
                    className={`text-base font-semibold ${task.status === 'completed' ? 'text-slate-500 line-through' : 'text-ink'}`}
                  >
                    {task.title}
                  </Text>
                  {task.description ? (
                    <Text className="mt-1 text-sm text-slate-600">{task.description}</Text>
                  ) : null}
                  <Text className="mt-2 text-xs capitalize text-slate-500">
                    {taskStatusLabel(task)} · {task.priority} priority
                    {task.plannedTime ? ` · ${task.plannedTime}` : ''}
                    {task.estimatedMinutes ? ` · ${task.estimatedMinutes} min` : ''}
                  </Text>
                </View>
                <Text className="ml-3 text-sm font-semibold text-primary">
                  {historical
                    ? ''
                    : task.status === 'pending'
                      ? 'Actions'
                      : task.status === 'completed'
                        ? 'Reopen'
                        : 'Edit'}
                </Text>
              </View>
            </Pressable>
            {!historical && task.status === 'pending' ? (
              <View className="mt-3">
                <Button
                  title="Focus on this task"
                  variant="secondary"
                  onPress={() =>
                    router.push(
                      habitHref(
                        `/focus/setup?taskId=${encodeURIComponent(task.id)}&title=${encodeURIComponent(task.title)}`,
                      ),
                    )
                  }
                />
              </View>
            ) : null}
          </View>
        ))
      ) : (
        <EmptyState
          title="No tasks for this day"
          message="Add one-time tasks to keep your plan clear."
        />
      )}
      {deleted.data?.length ? (
        <>
          <SectionTitle title="Recently deleted" />
          {deleted.data.map((task) => (
            <View
              key={task.id}
              className="mb-2 flex-row items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <Text className="flex-1 text-sm text-slate-700">{task.title}</Text>
              <Button
                title="Restore"
                fullWidth={false}
                variant="secondary"
                onPress={() => taskMutation.mutate({ taskId: task.id, action: 'restore' })}
              />
            </View>
          ))}
        </>
      ) : null}

      <SectionTitle title="Timeline" />
      {timeline.length ? (
        <Card>
          {timeline.map((item, index) => {
            const activity =
              item.kind === 'actual'
                ? (entries.data ?? []).find((entry) => `actual:${entry.id}` === item.id)
                : undefined;
            const content = (
              <>
                <Text className="w-14 pt-0.5 text-xs font-semibold text-slate-500">
                  {item.time ?? '—'}
                </Text>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-ink">{item.title}</Text>
                  <Text className="mt-1 text-xs capitalize text-slate-600">
                    {item.detail} ·{' '}
                    {item.kind === 'planned'
                      ? `planned, ${item.status}`
                      : `recorded, ${item.status}`}
                  </Text>
                </View>
              </>
            );
            return activity ? (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Inspect activity: ${item.title}`}
                onPress={() =>
                  activity.value_mode === 'daily_total'
                    ? Alert.alert('Daily usage total', `${activity.note} · ${activity.local_date}`)
                    : activity.focus_session_id
                      ? router.push(
                          habitHref(
                            `/focus/session?sessionId=${encodeURIComponent(activity.focus_session_id)}`,
                          ),
                        )
                      : activity.kind === 'progress'
                        ? setSelectedEntry(activity)
                        : Alert.alert(
                            item.title,
                            `${item.detail} · ${activity.local_date} ${localTimeAt(activity.occurred_at, activity.timezone)}`,
                            [
                              {
                                text: 'Remove',
                                style: 'destructive',
                                onPress: () => deleteActivityMutation.mutate(activity.id),
                              },
                              { text: 'Close', style: 'cancel' },
                            ],
                          )
                }
                className={`flex-row items-start py-3 ${index ? 'border-t border-slate-100' : ''}`}
              >
                {content}
              </Pressable>
            ) : (
              <View
                key={item.id}
                className={`flex-row items-start py-3 ${index ? 'border-t border-slate-100' : ''}`}
              >
                {content}
              </View>
            );
          })}
        </Card>
      ) : (
        <EmptyState
          title="No timeline yet"
          message="Planned activities and recorded check-ins will appear here."
        />
      )}
      {lastLoggedId && !historical ? (
        <View className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-sm text-emerald-900">
              Activity saved offline on this device.
            </Text>
            <Button
              title="Undo"
              fullWidth={false}
              variant="quiet"
              loading={deleteActivityMutation.isPending}
              onPress={() => deleteActivityMutation.mutate(lastLoggedId)}
            />
          </View>
        </View>
      ) : null}
      {(entries.data ?? []).some((entry) => !!entry.deleted_at) ? (
        <>
          <SectionTitle title="Removed activities" />
          {(entries.data ?? [])
            .filter((entry) => !!entry.deleted_at)
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
                    : restoreActivityMutation.mutate(entry.id)
                }
              />
            ))}
        </>
      ) : null}

      <SectionTitle title="Day summary" />
      <Card>
        {reviewFacts.data ? (
          <View className="flex-row flex-wrap gap-2">
            <View className="min-w-[44%] flex-1 rounded-xl bg-slate-50 p-3">
              <Text className="text-lg font-bold text-ink">
                {doneHabits}/{scheduledHabits.length}
              </Text>
              <Text className="text-xs text-slate-600">Habits completed</Text>
              <Text className="mt-1 text-[11px] text-slate-500">
                {
                  scheduledHabits.filter((habit) =>
                    ['pending', 'partial', 'missed', 'incident', 'unknown'].includes(
                      habit.todayState,
                    ),
                  ).length
                }{' '}
                pending, partial, missed, or unknown
              </Text>
            </View>
            <View className="min-w-[44%] flex-1 rounded-xl bg-slate-50 p-3">
              <Text className="text-lg font-bold text-ink">
                {(tasks.data ?? []).filter((task) => task.completedLocalDate === date).length}/
                {(tasks.data ?? []).filter((task) => task.plannedDate === date).length}
              </Text>
              <Text className="text-xs text-slate-600">
                Tasks completed on this day ·{' '}
                {
                  (tasks.data ?? []).filter(
                    (task) => task.plannedDate === date && task.status === 'pending',
                  ).length
                }{' '}
                pending
              </Text>
            </View>
            <View className="min-w-[44%] flex-1 rounded-xl bg-slate-50 p-3">
              <Text className="text-lg font-bold text-ink">
                {reviewFacts.data?.focusSessions ?? 0} sessions ·{' '}
                {Math.round((reviewFacts.data?.focusSeconds ?? 0) / 60)} min
              </Text>
              <Text className="text-xs text-slate-600">Recorded focus time</Text>
            </View>
            <View className="min-w-[44%] flex-1 rounded-xl bg-slate-50 p-3">
              <Text className="text-lg font-bold text-ink">
                {reviewFacts.data?.recordedActivities ?? 0} activities ·{' '}
                {reviewFacts.data?.routineRuns ?? 0} routine runs
              </Text>
              <Text className="text-xs text-slate-600">
                {reviewFacts.data?.confirmedUsageTotals ?? 0} confirmed usage totals ·{' '}
                {reviewFacts.data?.routineCompletedSteps ?? 0} steps completed ·{' '}
                {reviewFacts.data?.routineSkippedSteps ?? 0} skipped
              </Text>
            </View>
          </View>
        ) : (
          <Text className="text-sm text-slate-600">
            {reviewFacts.isError
              ? 'Could not load recorded focus and routine details.'
              : 'Loading recorded day details…'}
          </Text>
        )}
        {goals.data?.some((goal) => ['active', 'paused', 'achieved'].includes(goal.status)) ? (
          <View className="mt-3 border-t border-slate-100 pt-3">
            <Text className="mb-2 text-sm font-semibold text-ink">Goal progress</Text>
            {goals.data
              .filter((goal) => ['active', 'paused', 'achieved'].includes(goal.status))
              .slice(0, 3)
              .map((goal) => (
                <Text key={goal.id} className="mb-1 text-sm text-slate-600">
                  {goal.title} · {goal.progress.progressPercent}% · {goal.status}
                </Text>
              ))}
          </View>
        ) : null}
        {reviewFacts.data?.trackedRecords.length ? (
          <View className="mt-3 border-t border-slate-100 pt-3">
            <Text className="mb-2 text-sm font-semibold text-ink">Recorded measurements</Text>
            {reviewFacts.data.trackedRecords.slice(0, 4).map((record) => (
              <Text key={record.id} className="mb-1 text-xs text-slate-600">
                {record.name} · {record.value} {record.unit} · {record.source.replaceAll('_', ' ')}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      <SectionTitle title="End-of-day review" />
      <Card>
        {review.data?.wentWell || review.data?.improve || review.data?.tomorrowPriority ? (
          <View className="gap-2">
            {review.data.wentWell ? (
              <Text className="text-sm text-slate-700">Went well · {review.data.wentWell}</Text>
            ) : null}
            {review.data.improve ? (
              <Text className="text-sm text-slate-700">To improve · {review.data.improve}</Text>
            ) : null}
            {review.data.tomorrowPriority ? (
              <Text className="text-sm text-slate-700">
                Tomorrow · {review.data.tomorrowPriority}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text className="text-sm text-slate-600">
            A short reflection is optional. Use the factual summary above to review this day.
          </Text>
        )}
        {date <= today ? (
          <View className="mt-3">
            <Button
              title={review.data ? 'Edit review' : 'Write review'}
              variant="secondary"
              onPress={() => setReviewOpen(true)}
            />
          </View>
        ) : null}
      </Card>
      <View className="mt-8 pb-4">
        <Button
          title="Sign out"
          variant="quiet"
          loading={signingOut}
          onPress={() => void logout()}
        />
      </View>
      {showDatePicker ? (
        <DateChooser
          date={date}
          onChange={(picked) => {
            setDate(picked);
            if (Platform.OS === 'ios') setShowDatePicker(false);
          }}
          onClose={() => setShowDatePicker(false)}
        />
      ) : null}
      {selectedHabit ? (
        <ActivityLogSheet
          visible
          habit={selectedHabit}
          onClose={() => setSelectedHabit(null)}
          onSave={(input) => activityMutation.mutateAsync(input).then(() => undefined)}
        />
      ) : null}
      {dailyTotalHabit ? (
        <ProgressModal
          visible
          habit={dailyTotalHabit}
          mode="daily_total"
          onClose={() => setDailyTotalHabit(null)}
          onSave={async (value) => {
            await recordDigitalUsageTotal(dailyTotalHabit, value);
            setDailyTotalHabit(null);
            await client.invalidateQueries({ queryKey: ['habits'] });
            await client.invalidateQueries({ queryKey: ['goals'] });
            await client.invalidateQueries({ queryKey: ['planner'] });
            showToast('Daily usage total confirmed.', 'success');
          }}
        />
      ) : null}
      <ActivityLogSheet
        visible={quickLogOpen}
        habit={null}
        onClose={() => setQuickLogOpen(false)}
        onSave={(input) => activityMutation.mutateAsync(input).then(() => undefined)}
      />
      {selectedEntry ? (
        <ActivityLogSheet
          visible
          habit={selectedEntryHabit}
          existing={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onSave={(input, id) =>
            id
              ? editActivityMutation.mutateAsync({ id, input })
              : activityMutation.mutateAsync(input).then(() => undefined)
          }
          onDelete={() =>
            Alert.alert(
              'Remove this activity?',
              'It will be removed from totals and can be restored from Removed activities.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => deleteActivityMutation.mutate(selectedEntry.id),
                },
              ],
            )
          }
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
      <ReviewModal
        key={`${date}:${review.data?.updatedAt ?? 'new'}`}
        visible={reviewOpen}
        date={date}
        initialReview={{
          wentWell: review.data?.wentWell ?? review.data?.note ?? '',
          improve: review.data?.improve ?? '',
          tomorrowPriority: review.data?.tomorrowPriority ?? '',
        }}
        onClose={() => setReviewOpen(false)}
        onSave={(input) => reviewMutation.mutateAsync(input)}
      />
    </ScreenLayout>
  );
}
