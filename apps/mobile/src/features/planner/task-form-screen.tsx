import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { useToast } from '../../components/feedback/toast-provider';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/feedback-state';
import { FormTextField } from '../../components/ui/form-text-field';
import { useAuth } from '../auth/auth-context';
import { todayInTimezone } from '../habits/domain/habit-domain';
import { HabitNavigation } from '../habits/habit-navigation';
import { getTask, saveTask } from './planner-repository';
import { taskSchema, type TaskInput, type TaskPriority } from './planner-domain';

const priorities: readonly TaskPriority[] = ['low', 'normal', 'high'];
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function dateValue(value: string, time = '12:00'): Date {
  const [year = 2000, month = 1, day = 1] = value.split('-').map(Number);
  const [hour = 12, minute = 0] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}
function dateText(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function timeText(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function TaskFormScreen({ editing = false }: { editing?: boolean }) {
  const { status } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string }>();
  const taskId = typeof params.taskId === 'string' ? params.taskId : undefined;
  const client = useQueryClient();
  const { showToast } = useToast();
  const task = useQuery({
    queryKey: ['planner', 'task', taskId],
    queryFn: () => getTask(taskId!),
    enabled: editing && !!taskId,
  });
  const [datePicker, setDatePicker] = useState(false);
  const [timePicker, setTimePicker] = useState(false);
  const form = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'normal',
      plannedDate: todayInTimezone(timezone),
      plannedTime: '',
      estimatedMinutes: '',
      timezone,
    },
  });
  const plannedDate = form.watch('plannedDate');
  const plannedTime = form.watch('plannedTime');
  const pickerValue = useMemo(
    () => dateValue(plannedDate || todayInTimezone(timezone), plannedTime || '12:00'),
    [plannedDate, plannedTime],
  );

  useEffect(() => {
    if (task.data) {
      form.reset({
        title: task.data.title,
        description: task.data.description,
        priority: task.data.priority,
        plannedDate: task.data.plannedDate,
        plannedTime: task.data.plannedTime ?? '',
        estimatedMinutes: task.data.estimatedMinutes?.toString() ?? '',
        timezone: task.data.timezone,
      });
    }
  }, [task.data, form]);

  const mutation = useMutation({
    mutationFn: (values: TaskInput) => saveTask(taskSchema.parse(values), taskId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['planner'] });
      showToast(editing ? 'Task updated.' : 'Task added.', 'success');
      router.replace('/today');
    },
    onError: () => showToast('Could not save this task. Try again.', 'error'),
  });
  if (status !== 'authenticated') return <Redirect href="/" />;
  if (editing && task.isLoading)
    return (
      <ScreenLayout>
        <Text className="py-10 text-center text-slate-600">Loading task…</Text>
      </ScreenLayout>
    );
  if (editing && (task.isError || !task.data))
    return (
      <ScreenLayout>
        <ErrorState message="This task could not be loaded." onRetry={() => void task.refetch()} />
      </ScreenLayout>
    );

  const requestClose = () => {
    if (form.formState.isDirty)
      Alert.alert('Discard changes?', 'Your task changes have not been saved.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    else router.back();
  };
  const onDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setDatePicker(false);
    if (selected && event.type !== 'dismissed')
      form.setValue('plannedDate', dateText(selected), { shouldDirty: true, shouldValidate: true });
  };
  const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setTimePicker(false);
    if (selected && event.type !== 'dismissed')
      form.setValue('plannedTime', timeText(selected), { shouldDirty: true, shouldValidate: true });
  };

  return (
    <ScreenLayout
      bottomNavigation={<HabitNavigation selected="today" />}
      header={{
        title: editing ? 'Edit task' : 'New task',
        subtitle: 'A one-time item for your plan',
      }}
    >
      <FormTextField
        control={form.control}
        name="title"
        label="Task"
        placeholder="e.g. Call the dentist"
        autoCapitalize="sentences"
        returnKeyType="next"
      />
      <FormTextField
        control={form.control}
        name="description"
        label="Description · optional"
        placeholder="Add a little context"
        multiline
        numberOfLines={3}
        autoCapitalize="sentences"
      />
      <Text className="mb-2 text-sm font-medium text-ink">Priority</Text>
      <View className="mb-5 flex-row gap-2">
        {priorities.map((priority) => {
          const selected = form.watch('priority') === priority;
          return (
            <Pressable
              key={priority}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => form.setValue('priority', priority, { shouldDirty: true })}
              className={`min-h-11 flex-1 items-center justify-center rounded-full border px-3 ${selected ? 'border-primary bg-indigo-50' : 'border-slate-300 bg-white'}`}
            >
              <Text
                className={`text-sm font-medium capitalize ${selected ? 'text-primary' : 'text-slate-700'}`}
              >
                {priority}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 text-sm font-medium text-ink">Planned date</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose date, ${plannedDate}`}
        onPress={() => setDatePicker(true)}
        className="mb-4 min-h-12 justify-center rounded-xl border border-slate-300 bg-white px-4"
      >
        <Text className="text-base text-ink">{plannedDate}</Text>
      </Pressable>
      {datePicker ? (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onDateChange}
        />
      ) : null}
      <Text className="mb-2 text-sm font-medium text-ink">Planned time · optional</Text>
      <View className="mb-5 flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            plannedTime ? `Change planned time, ${plannedTime}` : 'Choose planned time'
          }
          onPress={() => setTimePicker(true)}
          className="min-h-12 flex-1 justify-center rounded-xl border border-slate-300 bg-white px-4"
        >
          <Text className={`text-base ${plannedTime ? 'text-ink' : 'text-slate-400'}`}>
            {plannedTime || 'No time set'}
          </Text>
        </Pressable>
        {plannedTime ? (
          <Button
            title="Clear"
            variant="secondary"
            fullWidth={false}
            onPress={() =>
              form.setValue('plannedTime', '', { shouldDirty: true, shouldValidate: true })
            }
          />
        ) : null}
      </View>
      {timePicker ? (
        <DateTimePicker value={pickerValue} mode="time" onChange={onTimeChange} />
      ) : null}
      <FormTextField
        control={form.control}
        name="estimatedMinutes"
        label="Estimated duration · optional"
        placeholder="e.g. 30"
        keyboardType="number-pad"
      />
      <View className="gap-3 pb-4">
        {form.formState.errors.root?.message ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-red-700">
            {form.formState.errors.root.message}
          </Text>
        ) : null}
        <Button
          title={editing ? 'Save changes' : 'Add task'}
          loading={mutation.isPending}
          disabled={mutation.isPending}
          onPress={form.handleSubmit((values) => mutation.mutateAsync(values))}
        />
        <Button
          title="Cancel"
          variant="secondary"
          disabled={mutation.isPending}
          onPress={requestClose}
        />
      </View>
    </ScreenLayout>
  );
}
