import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type PropsWithChildren } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { z } from 'zod';
import { useToast } from '../../components/feedback/toast-provider';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { Button } from '../../components/ui/button';
import { FormTextField } from '../../components/ui/form-text-field';
import {
  getReminderChoices,
  getNotificationPermission,
  getReminderPreferences,
  openNotificationSettings,
  reminderPreferencesSchema,
  saveReminderPreferences,
  setReminderOverride,
} from './notification-service';

const settingsFormSchema = z
  .object({
    enabled: z.boolean(),
    preferredTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, such as 18:00.'),
    advanceMinutes: z.string().regex(/^(0|5|10|15|30|60|120)$/, 'Choose a supported offset.'),
    flexibleWarningMinutes: z
      .string()
      .regex(/^(0|15|30|60|120|240)$/, 'Choose a supported warning.'),
    quietStart: z.string(),
    quietEnd: z.string(),
    soundEnabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.quietStart) !== Boolean(value.quietEnd))
      context.addIssue({
        code: 'custom',
        path: ['quietEnd'],
        message: 'Set both quiet-hour times or leave both empty.',
      });
    if (value.quietStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietStart))
      context.addIssue({ code: 'custom', path: ['quietStart'], message: 'Use 24-hour time.' });
    if (value.quietEnd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietEnd))
      context.addIssue({ code: 'custom', path: ['quietEnd'], message: 'Use 24-hour time.' });
  });
type SettingsForm = z.infer<typeof settingsFormSchema>;
const toForm = (value: Awaited<ReturnType<typeof getReminderPreferences>>): SettingsForm => ({
  ...value,
  advanceMinutes: String(value.advanceMinutes),
  flexibleWarningMinutes: String(value.flexibleWarningMinutes),
});

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View className="mb-6">
      <Text accessibilityRole="header" className="mb-3 text-lg font-bold text-ink">
        {title}
      </Text>
      <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">{children}</View>
    </View>
  );
}

export function NotificationSettingsScreen() {
  const client = useQueryClient();
  const { showToast } = useToast();
  const preferences = useQuery({
    queryKey: ['reminders', 'preferences'],
    queryFn: getReminderPreferences,
  });
  const permission = useQuery({
    queryKey: ['reminders', 'permission'],
    queryFn: getNotificationPermission,
  });
  const reminderChoices = useQuery({
    queryKey: ['reminders', 'choices'],
    queryFn: getReminderChoices,
  });
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      enabled: false,
      preferredTime: '18:00',
      advanceMinutes: '0',
      flexibleWarningMinutes: '60',
      quietStart: '',
      quietEnd: '',
      soundEnabled: true,
    },
  });
  useEffect(() => {
    if (preferences.data) form.reset(toForm(preferences.data));
  }, [preferences.data, form]);
  const save = form.handleSubmit(async (value) => {
    try {
      const parsed = settingsFormSchema.parse(value);
      await saveReminderPreferences(
        reminderPreferencesSchema.parse({
          ...parsed,
          advanceMinutes: Number(parsed.advanceMinutes),
          flexibleWarningMinutes: Number(parsed.flexibleWarningMinutes),
        }),
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['reminders'] }),
        client.invalidateQueries({ queryKey: ['reminders', 'permission'] }),
      ]);
      showToast('Reminder settings saved.', 'success');
    } catch (error) {
      if (error instanceof Error && error.message.includes('device settings')) {
        form.setValue('enabled', false);
        await client.invalidateQueries({ queryKey: ['reminders', 'permission'] });
      }
      showToast(
        error instanceof Error ? error.message : 'Could not save reminder settings.',
        'error',
      );
    }
  });
  return (
    <ScreenLayout header={{ title: 'Reminders', subtitle: 'Small nudges, on your schedule.' }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <Section title="Notifications">
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1">
              <Text className="font-semibold text-ink">Enable reminders</Text>
              <Text className="mt-1 text-sm text-slate-600">
                Local notifications only. No account or push service.
              </Text>
            </View>
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch
                  accessibilityLabel="Enable reminders"
                  value={field.value && permission.data?.granted === true}
                  disabled={permission.isLoading}
                  onValueChange={field.onChange}
                  trackColor={{ true: '#4F46E5' }}
                />
              )}
            />
          </View>
          <Text className="text-sm text-slate-600">
            Permission:{' '}
            {permission.data?.granted
              ? 'Allowed'
              : permission.data?.status === 'undetermined'
                ? 'Not requested'
                : permission.data?.canAskAgain
                  ? 'Denied'
                  : 'Blocked in device settings'}
          </Text>
          {permission.data && !permission.data.granted && !permission.data.canAskAgain ? (
            <Button
              title="Open device settings"
              variant="secondary"
              onPress={() => void openNotificationSettings()}
            />
          ) : null}
        </Section>
        <Section title="Reminder timing">
          <FormTextField
            control={form.control}
            name="preferredTime"
            label="Preferred time for anytime habits · HH:mm"
            placeholder="18:00"
            keyboardType="numbers-and-punctuation"
          />
          <Text className="-mt-4 text-sm font-medium text-ink">
            Advance reminder · minutes before
          </Text>
          <Controller
            control={form.control}
            name="advanceMinutes"
            render={({ field }) => (
              <View className="flex-row flex-wrap gap-2">
                {['0', '5', '10', '15', '30', '60'].map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: field.value === value }}
                    onPress={() => field.onChange(value)}
                    className={`rounded-full border px-4 py-2 ${field.value === value ? 'border-primary bg-indigo-50' : 'border-slate-200'}`}
                  >
                    <Text
                      className={
                        field.value === value ? 'font-semibold text-primary' : 'text-slate-700'
                      }
                    >
                      {value === '0' ? 'At time' : `${value}m`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          />
          <FormTextField
            control={form.control}
            name="flexibleWarningMinutes"
            label="Flexible-window warning · minutes"
            placeholder="60"
            keyboardType="number-pad"
          />
          <FormTextField
            control={form.control}
            name="quietStart"
            label="Quiet hours start · optional"
            placeholder="22:00"
            keyboardType="numbers-and-punctuation"
          />
          <FormTextField
            control={form.control}
            name="quietEnd"
            label="Quiet hours end · optional"
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
          />
          <View className="flex-row items-center justify-between">
            <Text className="font-medium text-ink">Notification sound</Text>
            <Controller
              control={form.control}
              name="soundEnabled"
              render={({ field }) => (
                <Switch
                  accessibilityLabel="Notification sound"
                  value={field.value}
                  onValueChange={field.onChange}
                  trackColor={{ true: '#4F46E5' }}
                />
              )}
            />
          </View>
        </Section>
        <Section title="Activity reminders">
          {reminderChoices.data?.length ? (
            reminderChoices.data.map((activity) => {
              return (
                <View
                  key={`${activity.kind}:${activity.id}`}
                  className="flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-ink">{activity.title}</Text>
                    <Text className="text-xs capitalize text-slate-500">{activity.kind}</Text>
                  </View>
                  <Switch
                    accessibilityLabel={`Remind me about ${activity.title}`}
                    value={activity.enabled}
                    onValueChange={async (value) => {
                      try {
                        await setReminderOverride(activity.kind, activity.id, value);
                        await client.invalidateQueries({ queryKey: ['reminders', 'choices'] });
                      } catch {
                        showToast('Could not update this reminder.', 'error');
                      }
                    }}
                    trackColor={{ true: '#4F46E5' }}
                  />
                </View>
              );
            })
          ) : (
            <Text className="text-sm text-slate-600">
              Add a scheduled habit, task, goal, or routine to configure its reminder.
            </Text>
          )}
        </Section>
        <Button
          title="Save reminder settings"
          loading={form.formState.isSubmitting}
          disabled={form.formState.isSubmitting}
          onPress={save}
        />
        <Text className="mt-4 text-xs leading-5 text-slate-500">
          Notifications already scheduled by iOS or Android may still arrive if an activity changes
          while Streak is closed.
        </Text>
      </ScrollView>
    </ScreenLayout>
  );
}
