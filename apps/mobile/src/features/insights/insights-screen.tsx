import { useQuery } from '@tanstack/react-query';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Redirect, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { AppIcon } from '../../components/ui/app-icon';
import { Button, IconButton } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { useAuth } from '../auth/auth-context';
import { dateAdd, todayInTimezone } from '../habits/domain/habit-domain';
import { formatGoalTarget } from '../goals-routines/goal-repository';
import { getInsightsData, type InsightsData } from './insights-repository';
import {
  insightDateRange,
  compareEquivalentPeriods,
  validateInsightRange,
  type InsightPreset,
} from './insights-domain';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function dateFromNative(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function nativeDate(date: string) {
  const [year = 2000, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function durationLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function Card({ children }: { children: React.ReactNode }) {
  return <View className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">{children}</View>;
}
function Heading({ title, detail }: { title: string; detail?: string }) {
  return (
    <View className="mb-3 mt-6">
      <Text accessibilityRole="header" className="text-lg font-bold text-ink">
        {title}
      </Text>
      {detail ? <Text className="mt-1 text-sm text-slate-500">{detail}</Text> : null}
    </View>
  );
}
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View className="min-w-[44%] flex-1 rounded-xl bg-slate-50 p-3">
      <Text className="text-xl font-bold text-ink">{value}</Text>
      <Text className="mt-1 text-xs font-medium text-slate-600">{label}</Text>
      {detail ? <Text className="mt-1 text-[11px] text-slate-500">{detail}</Text> : null}
    </View>
  );
}
function Bar({
  value,
  max,
  label,
  valueLabel,
  accessibilityLabel,
}: {
  value: number;
  max: number;
  label: string;
  valueLabel?: string;
  accessibilityLabel: string;
}) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View className="mb-2">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xs text-slate-600">{label}</Text>
        <Text className="text-xs font-medium text-ink" accessibilityLabel={accessibilityLabel}>
          {valueLabel ?? value}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max, now: value }}
        className="h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <View className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </View>
    </View>
  );
}
function stateColor(state: string) {
  if (state === 'completed' || state === 'clean') return '#4F46E5';
  if (state === 'missed' || state === 'incident') return '#F43F5E';
  if (state === 'partial' || state === 'skipped') return '#F59E0B';
  if (state === 'paused') return '#94A3B8';
  return '#E2E8F0';
}

export function InsightsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const today = todayInTimezone(timezone);
  const [preset, setPreset] = useState<InsightPreset>('7d');
  const [customStart, setCustomStart] = useState(dateAdd(today, -6));
  const [customEnd, setCustomEnd] = useState(today);
  const [dateField, setDateField] = useState<'start' | 'end' | null>(null);
  const range =
    preset === 'custom'
      ? { startDate: customStart, endDate: customEnd }
      : insightDateRange(preset, today);
  const rangeValid = validateInsightRange(range.startDate, range.endDate) && range.endDate <= today;
  const query = useQuery({
    queryKey: ['insights', range.startDate, range.endDate],
    queryFn: () => getInsightsData(range.startDate, range.endDate),
    enabled: rangeValid,
  });
  const focusDays = useMemo(() => {
    const dates: string[] = [];
    for (
      let day = range.startDate;
      day <= range.endDate && dates.length < 90;
      day = dateAdd(day, 1)
    )
      dates.push(day);
    const daily = dates.map((date) => ({
      date,
      seconds: query.data?.focus.daily.find((item) => item.date === date)?.seconds ?? 0,
    }));
    if (daily.length <= 30) return daily.map((day) => ({ ...day, label: day.date.slice(5) }));
    const weekly: Array<{ date: string; label: string; seconds: number }> = [];
    for (let index = 0; index < daily.length; index += 7) {
      const chunk = daily.slice(index, index + 7);
      weekly.push({
        date: chunk[0]!.date,
        label: chunk[0]!.date.slice(5),
        seconds: chunk.reduce((sum, day) => sum + day.seconds, 0),
      });
    }
    return weekly;
  }, [query.data, range.startDate, range.endDate]);
  const maxFocus = Math.max(0, ...focusDays.map((day) => day.seconds));
  const focusChange =
    query.data?.focus.previousPeriodSeconds == null
      ? null
      : compareEquivalentPeriods(
          query.data.focus.totalSeconds,
          query.data.focus.previousPeriodSeconds,
          true,
        );
  const digitalKeys = new Set(
    (query.data?.digitalUsage ?? []).map((item) => `${item.id}:${item.measurement}`),
  );
  const walkingIds = new Set((query.data?.walking ?? []).map((item) => item.id));
  const otherMeasurements = (query.data?.measurements ?? []).filter(
    (item) =>
      !digitalKeys.has(`${item.id}:${item.measurement}`) &&
      !(walkingIds.has(item.id) && item.measurement === 'distance'),
  );
  const measurementTrends = groupMeasurementDays(query.data?.measurementDaily ?? []).filter(
    (item) =>
      !digitalKeys.has(`${item.id}:${item.measurement}`) &&
      !(walkingIds.has(item.id) && item.measurement === 'distance'),
  );

  if (status === 'loading')
    return (
      <ScreenLayout>
        <Text className="py-10 text-center text-slate-600">Loading Insights…</Text>
      </ScreenLayout>
    );
  if (status !== 'authenticated') return <Redirect href="/" />;

  return (
    <ScreenLayout
      header={{
        title: 'Insights',
        subtitle: `${range.startDate} – ${range.endDate}`,
        action: (
          <IconButton
            accessibilityLabel="Back to Today"
            icon={<AppIcon name="chevronLeft" />}
            onPress={() => router.back()}
          />
        ),
      }}
    >
      <View className="mt-2 flex-row flex-wrap gap-2">
        {(
          [
            ['today', 'Today'],
            ['7d', '7 days'],
            ['30d', '30 days'],
            ['custom', 'Custom'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: preset === value }}
            onPress={() => setPreset(value)}
            className={`min-h-11 justify-center rounded-full border px-4 ${preset === value ? 'border-primary bg-indigo-50' : 'border-slate-200 bg-white'}`}
          >
            <Text
              className={`text-sm font-medium ${preset === value ? 'text-primary' : 'text-slate-600'}`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {preset === 'custom' ? (
        <View className="mt-3 flex-row gap-2">
          <Button
            title={`From ${customStart}`}
            variant="secondary"
            fullWidth={false}
            onPress={() => setDateField('start')}
          />
          <Button
            title={`To ${customEnd}`}
            variant="secondary"
            fullWidth={false}
            onPress={() => setDateField('end')}
          />
        </View>
      ) : null}
      {!rangeValid ? (
        <Text className="mt-3 text-sm text-rose-700">
          Choose a valid range of up to 90 days ending today.
        </Text>
      ) : null}
      {query.isLoading && rangeValid ? (
        <Text className="py-8 text-center text-slate-600">Calculating recorded trends…</Text>
      ) : null}
      {query.isError ? (
        <ErrorState message="Could not load your Insights." onRetry={() => void query.refetch()} />
      ) : null}
      {query.data ? (
        <>
          <Heading
            title="At a glance"
            detail={
              range.endDate === today
                ? 'Based only on recorded data. Today’s period is still in progress.'
                : 'Based only on records in the selected period.'
            }
          />
          <Card>
            <View className="flex-row flex-wrap gap-2">
              <Metric
                label="Recorded focus time"
                value={durationLabel(query.data.focus.totalSeconds)}
                detail={`${query.data.focus.sessions} completed sessions${focusChange === null ? '' : ` · ${focusChange >= 0 ? '+' : ''}${focusChange}% vs previous equal period`}`}
              />
              <Metric
                label="Habit consistency"
                value={
                  query.data.habits.some((habit) => habit.consistency !== null)
                    ? `${Math.round(query.data.habits.filter((habit) => habit.consistency !== null).reduce((sum, habit) => sum + (habit.consistency ?? 0), 0) / Math.max(1, query.data.habits.filter((habit) => habit.consistency !== null).length))}%`
                    : '—'
                }
                detail="Average across habits with eligible scheduled days"
              />
              <Metric
                label="Tasks completed"
                value={`${query.data.tasks.completed}`}
                detail={`${query.data.tasks.pending} pending · ${query.data.tasks.overdue} overdue`}
              />
              <Metric
                label="Routine steps"
                value={`${query.data.routines.completedSteps}`}
                detail={`${query.data.routines.skippedSteps} skipped · ${query.data.routines.completedRuns}/${query.data.routines.totalRuns} runs completed`}
              />
            </View>
          </Card>

          {query.data.habits.length ? (
            <>
              <Heading
                title="Habits"
                detail="Consistency uses eligible scheduled days. Unknown bad-habit days are not counted as clean."
              />
              {query.data.habits.map((habit) => (
                <Card key={habit.id}>
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-base font-semibold text-ink">{habit.name}</Text>
                    <Text className="ml-2 text-sm font-semibold text-primary">
                      {habit.consistency === null ? '—' : `${habit.consistency}%`}
                    </Text>
                  </View>
                  <Text className="mt-1 text-xs text-slate-500">
                    {habit.completed}/{habit.eligible} eligible days · current streak{' '}
                    {habit.currentStreak}
                    {habit.currentStreakCapped ? '+' : ''} · longest in recent{' '}
                    {habit.streakWindowDays} days {habit.longestStreak}
                  </Text>
                  <View className="mt-3 flex-row gap-1.5">
                    {habit.days.slice(-14).map((day) => (
                      <View
                        key={day.date}
                        accessibilityLabel={`${day.date}: ${day.state}`}
                        className="h-3 flex-1 rounded-full"
                        style={{ backgroundColor: stateColor(day.state) }}
                      />
                    ))}
                  </View>
                  <Text className="mt-1 text-[10px] text-slate-500">
                    Recent scheduled-day status ·{' '}
                    {habit.days
                      .slice(-14)
                      .map((day) => day.date.slice(8))
                      .join(' ')}
                  </Text>
                </Card>
              ))}
            </>
          ) : null}

          <Heading
            title="Focus and recorded time"
            detail="Credited focus-session duration, allocated to local calendar dates. This is not a measure of all productive time."
          />
          <Card>
            {focusDays.some((day) => day.seconds > 0) ? (
              focusDays.map((day) => (
                <Bar
                  key={day.date}
                  value={Math.round(day.seconds / 60)}
                  max={Math.max(1, Math.ceil(maxFocus / 60))}
                  label={day.label}
                  valueLabel={durationLabel(day.seconds)}
                  accessibilityLabel={`${day.date}: ${durationLabel(day.seconds)} recorded focus time`}
                />
              ))
            ) : (
              <EmptyState
                title="No saved focus sessions"
                message="Completed and saved sessions will appear here."
              />
            )}
            {query.data.focus.byActivity.length ? (
              <View className="mt-3 border-t border-slate-100 pt-3">
                <Text className="mb-2 text-sm font-semibold text-ink">
                  Recorded focus time by activity
                </Text>
                {query.data.focus.byActivity.map((item) => (
                  <View key={item.title} className="mb-1 flex-row justify-between">
                    <Text className="flex-1 text-sm text-slate-600">{item.title}</Text>
                    <Text className="ml-2 text-sm font-medium text-ink">
                      {durationLabel(item.seconds)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          {query.data.goals.length ? (
            <>
              <Heading
                title="Goals"
                detail={`${query.data.achievedMilestones} achieved milestones recorded`}
              />
              {query.data.goals.slice(0, 6).map((goal) => (
                <Card key={goal.id}>
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-base font-semibold text-ink">{goal.title}</Text>
                    <Text className="ml-2 text-sm font-semibold text-primary">
                      {goal.progress.progressPercent}%
                    </Text>
                  </View>
                  <Text className="mt-1 text-xs text-slate-500">
                    {goal.model === 'recurring'
                      ? `${goal.progress.achievedPeriods}/${goal.progress.elapsedPeriods} periods · ${goal.progress.missedPeriods} missed`
                      : `${goal.progress.totalValue.toFixed(1)} / ${formatGoalTarget(goal)}`}{' '}
                    · {goal.status}
                  </Text>
                  {goal.status === 'paused' ||
                  goal.status === 'ended' ||
                  (goal.model === 'recurring' && goal.progress.missedPeriods > 0) ? (
                    <Text className="mt-1 text-xs font-medium text-amber-700">Needs attention</Text>
                  ) : null}
                </Card>
              ))}
            </>
          ) : null}

          <Heading title="Activities and routines" />
          <Card>
            <Text className="mb-3 text-sm text-slate-600">
              {query.data.categories.length
                ? 'Recorded activities by saved category'
                : 'No categorized activities recorded in this period.'}
            </Text>
            {query.data.categories.map((item) => (
              <Bar
                key={item.category}
                value={item.activities}
                max={Math.max(1, ...query.data!.categories.map((entry) => entry.activities))}
                label={item.category}
                accessibilityLabel={`${item.category}: ${item.activities} activities`}
              />
            ))}
          </Card>

          {otherMeasurements.length ? (
            <>
              <Heading
                title="Tracked measurements"
                detail="Only habits with recorded measurements are shown."
              />
              {otherMeasurements.map((item) => (
                <Card key={`${item.id}:${item.measurement}:${item.unit}`}>
                  <Text className="text-base font-semibold text-ink">{item.name}</Text>
                  <Text className="mt-1 text-sm text-slate-600">
                    {item.value} {item.unit} recorded · {item.source.replace('_', ' ')}
                  </Text>
                  {measurementTrends.filter(
                    (trend) =>
                      trend.id === item.id &&
                      trend.measurement === item.measurement &&
                      trend.unit === item.unit,
                  ).length > 1 ? (
                    <View className="mt-3 border-t border-slate-100 pt-3">
                      {measurementTrends
                        .filter(
                          (trend) =>
                            trend.id === item.id &&
                            trend.measurement === item.measurement &&
                            trend.unit === item.unit,
                        )
                        .map((trend) => (
                          <Bar
                            key={trend.date}
                            value={trend.value}
                            max={Math.max(
                              1,
                              ...measurementTrends
                                .filter(
                                  (entry) =>
                                    entry.id === item.id &&
                                    entry.measurement === item.measurement &&
                                    entry.unit === item.unit,
                                )
                                .map((entry) => entry.value),
                            )}
                            label={trend.date.slice(5)}
                            valueLabel={`${trend.value} ${trend.unit}`}
                            accessibilityLabel={`${trend.date}: ${trend.value} ${trend.unit} recorded for ${trend.name}`}
                          />
                        ))}
                    </View>
                  ) : null}
                </Card>
              ))}
            </>
          ) : null}

          {query.data.digitalUsage.length ? (
            <>
              <Heading
                title="Digital usage"
                detail="Only explicitly selected behaviors are shown. Incremental logs remain partial; confirmed manual daily totals replace them for that day."
              />
              {groupDigital(query.data.digitalUsage).map((item) => (
                <Card key={item.id}>
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 text-base font-semibold text-ink">{item.name}</Text>
                    <Text className="ml-2 text-sm font-semibold text-primary">
                      {item.overLimitDays} over limit
                    </Text>
                  </View>
                  <Text className="mt-1 text-sm text-slate-600">
                    {item.hasData
                      ? `${item.measurement === 'duration' ? durationLabel(item.value) : `${item.value} ${item.unit}`} logged · ${item.confirmedDays}/${item.loggedDays} days confirmed${item.measurement === 'duration' ? ` · ${durationLabel(item.target)} limit across logged days` : ` · ${item.target} count limit across logged days`}`
                      : `No usage data recorded · daily limit ${item.measurement === 'duration' ? durationLabel(item.target) : `${item.target} ${item.unit}`}`}
                  </Text>
                </Card>
              ))}
            </>
          ) : null}

          {query.data.walking.length ? (
            <>
              <Heading
                title="Walking"
                detail="Configured walking activities only. Device snapshots replace manual distance on snapshot dates; manual records fill dates without a snapshot."
              />
              {query.data.walking.map((item) => (
                <Card key={item.id}>
                  <Text className="text-base font-semibold text-ink">{item.name}</Text>
                  <Text className="mt-1 text-sm text-slate-600">
                    {(item.distanceMeters / 1000).toFixed(2)} km across {item.days} recorded days
                  </Text>
                </Card>
              ))}
            </>
          ) : null}
          <Text className="mb-6 mt-4 text-center text-xs text-slate-500">
            No universal productivity score is calculated. Metrics reflect records saved in Streak.
          </Text>
        </>
      ) : null}
      {dateField ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDateField(null)}>
          <View className="flex-1 justify-end bg-slate-900/40">
            <View className="rounded-t-3xl bg-white p-5">
              <Text className="mb-2 text-lg font-semibold text-ink">
                Choose {dateField === 'start' ? 'start' : 'end'} date
              </Text>
              <DateTimePicker
                value={nativeDate(dateField === 'start' ? customStart : customEnd)}
                mode="date"
                maximumDate={nativeDate(today)}
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={(event: DateTimePickerEvent, picked?: Date) => {
                  if (event.type === 'dismissed') setDateField(null);
                  if (picked) {
                    const value = dateFromNative(picked);
                    if (dateField === 'start') setCustomStart(value);
                    else setCustomEnd(value);
                    if (Platform.OS !== 'ios') setDateField(null);
                  }
                }}
              />
              <Button title="Done" variant="secondary" onPress={() => setDateField(null)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </ScreenLayout>
  );
}

function groupDigital(items: InsightsData['digitalUsage']) {
  const grouped = new Map<
    string,
    (typeof items)[number] & { confirmedDays: number; loggedDays: number }
  >();
  for (const item of items) {
    const key = `${item.id}:${item.measurement}`;
    const current = grouped.get(key);
    if (current) {
      current.value += item.value;
      current.target += item.target;
      current.overLimitDays += item.overLimitDays;
      current.confirmedDays += Number(item.confirmed);
      current.loggedDays += Number(item.hasData);
      current.hasData = current.hasData || item.hasData;
    } else
      grouped.set(key, {
        ...item,
        confirmedDays: Number(item.confirmed),
        loggedDays: Number(item.hasData),
      });
  }
  return [...grouped.values()];
}

function groupMeasurementDays(items: InsightsData['measurementDaily']) {
  const grouped = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = `${item.id}:${item.measurement}:${item.unit}:${item.date}`;
    const current = grouped.get(key);
    if (current) current.value += item.value;
    else grouped.set(key, { ...item });
  }
  return [...grouped.values()];
}
