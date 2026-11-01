import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from '../../components/feedback/toast-provider';
import { AppHeader } from '../../components/layout/app-header';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { useAuth } from '../auth/auth-context';
import { canAccessPrivateRoutes } from '../auth/auth-navigation';
import { ActivityLogRow, ActivityLogSheet } from './activity-components';
import {
  createActivityLog,
  deleteActivityLog,
  getActivityLogsForHabit,
  getHabitBundle,
  newActivityKey,
  restoreActivityLog,
  updateActivityLog,
  type ActivityEntry,
} from './habit-repository';
import { HabitNavigation } from './habit-navigation';

const PAGE_SIZE = 30;

export function ActivityHistoryScreen() {
  const { status } = useAuth();
  const { habitId = '' } = useLocalSearchParams<{ habitId: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const habitQuery = useQuery({
    queryKey: ['habit', habitId],
    queryFn: () => getHabitBundle(habitId, true),
  });
  const logs = useInfiniteQuery({
    queryKey: ['activityLogs', habitId],
    queryFn: ({ pageParam }) => getActivityLogsForHabit(habitId, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    enabled: !!habitId,
  });
  const entries = useMemo(() => logs.data?.pages.flat() ?? [], [logs.data]);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['activityLogs', habitId] });
    await client.invalidateQueries({ queryKey: ['habit', habitId] });
    await client.invalidateQueries({ queryKey: ['habits'] });
    await client.invalidateQueries({ queryKey: ['planner'] });
  };
  const remove = useMutation({
    mutationFn: deleteActivityLog,
    onSuccess: async () => {
      await refresh();
      showToast('Activity removed. You can restore it here.', 'success');
      setSelected(null);
    },
    onError: () => showToast('Could not remove this activity.', 'error'),
  });
  const restore = useMutation({
    mutationFn: restoreActivityLog,
    onSuccess: async () => {
      await refresh();
      showToast('Activity restored.', 'success');
    },
    onError: () => showToast('Could not restore this activity.', 'error'),
  });
  if (!canAccessPrivateRoutes(status)) return <Redirect href="/" />;
  const habit = habitQuery.data?.habit;
  if (habitQuery.isError)
    return (
      <SafeAreaView className="flex-1 bg-canvas p-6">
        <ErrorState
          message="Could not load this habit's activity."
          onRetry={() => void habitQuery.refetch()}
        />
      </SafeAreaView>
    );
  if (!habit && !habitQuery.isLoading)
    return (
      <SafeAreaView className="flex-1 bg-canvas p-6">
        <EmptyState
          title="Habit unavailable"
          message="This activity history is no longer available."
        />
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerClassName="px-6 pb-5"
        onEndReached={() => {
          if (logs.hasNextPage && !logs.isFetchingNextPage) void logs.fetchNextPage();
        }}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={
          <View className="pt-6">
            <AppHeader
              title="Activity history"
              subtitle={habit?.name ?? 'Timestamped habit activity'}
            />
            <View className="mb-4">
              <Button title="Log activity" onPress={() => setNewOpen(true)} />
            </View>
            <Text className="mb-3 text-xs text-slate-500">
              Happened time and recorded time are both preserved.
            </Text>
          </View>
        }
        ListEmptyComponent={
          logs.isLoading ? (
            <Text className="py-8 text-center text-slate-500">Loading activity…</Text>
          ) : logs.isError ? (
            <ErrorState
              message="Could not load activity history."
              onRetry={() => void logs.refetch()}
            />
          ) : (
            <EmptyState title="No activity yet" message="Your progress entries will appear here." />
          )
        }
        ListFooterComponent={
          logs.isFetchingNextPage ? (
            <Text className="py-5 text-center text-slate-500">Loading more…</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ActivityLogRow
            entry={item}
            {...(!item.deleted_at
              ? {
                  onPress: () =>
                    item.value_mode === 'daily_total'
                      ? Alert.alert('Daily usage total', `${item.note} · ${item.local_date}`)
                      : item.focus_session_id
                        ? router.push(
                            `/focus/session?sessionId=${encodeURIComponent(item.focus_session_id)}` as Href,
                          )
                        : item.kind === 'progress'
                          ? setSelected(item)
                          : Alert.alert(
                              item.title || habit?.name || 'Activity',
                              `${item.kind.replaceAll('_', ' ')} · ${item.local_date}`,
                              [
                                {
                                  text: 'Remove',
                                  style: 'destructive',
                                  onPress: () => remove.mutate(item.id),
                                },
                                { text: 'Close', style: 'cancel' },
                              ],
                            ),
                }
              : {})}
            {...(item.deleted_at
              ? {
                  onRestore: () =>
                    item.focus_session_id
                      ? router.push(
                          `/focus/session?sessionId=${encodeURIComponent(item.focus_session_id)}` as Href,
                        )
                      : restore.mutate(item.id),
                }
              : {})}
          />
        )}
      />
      <HabitNavigation selected="habits" />
      {habit ? (
        <ActivityLogSheet
          visible={!!selected || newOpen}
          habit={habit}
          {...(selected ? { existing: selected } : {})}
          onClose={() => {
            setSelected(null);
            setNewOpen(false);
          }}
          onSave={async (input, id) => {
            if (id) await updateActivityLog(id, input);
            else await createActivityLog({ ...input, idempotencyKey: newActivityKey() });
            await refresh();
            showToast(id ? 'Activity corrected.' : 'Activity logged.', 'success');
            setNewOpen(false);
          }}
          onDelete={() => {
            if (!selected) return;
            Alert.alert('Remove this activity?', 'You can restore it from this history list.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(selected.id) },
            ]);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
