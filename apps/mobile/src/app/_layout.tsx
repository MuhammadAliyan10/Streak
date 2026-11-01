import '../../global.css';
import { Stack } from 'expo-router';
import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary } from '../components/layout/app-error-boundary';
import { AppProviders } from '../providers/app-providers';
import { useAuth } from '../features/auth/auth-context';
import { canAccessGuestRoutes, canAccessPrivateRoutes } from '../features/auth/auth-navigation';
import {
  listenForNotificationResponses,
  reconcileReminders,
} from '../features/notifications/notification-service';

function NotificationLifecycle() {
  const router = useRouter();
  useEffect(() => {
    void reconcileReminders().catch(() => undefined);
    const unsubscribe = listenForNotificationResponses((route) => router.push(route as Href));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcileReminders().catch(() => undefined);
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [router]);
  return null;
}

function AppRoutes() {
  const { status } = useAuth();
  const canAccessPrivate = canAccessPrivateRoutes(status);
  const canAccessGuest = canAccessGuestRoutes(status);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={canAccessGuest}>
        <Stack.Screen name="(auth)/sign-in" />
        <Stack.Screen name="(auth)/sign-up" />
      </Stack.Protected>
      <Stack.Protected guard={canAccessPrivate}>
        <Stack.Screen name="today" />
        <Stack.Screen name="insights" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="focus/setup" />
        <Stack.Screen
          name="focus/session"
          options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }}
        />
        <Stack.Screen name="goals/index" />
        <Stack.Screen name="goals/new" />
        <Stack.Screen name="goals/edit" />
        <Stack.Screen name="goals/[goalId]" />
        <Stack.Screen name="habits/index" />
        <Stack.Screen name="habits/new" />
        <Stack.Screen name="habits/history" />
        <Stack.Screen name="habits/[habitId]/index" />
        <Stack.Screen name="habits/[habitId]/edit" />
        <Stack.Screen name="habits/[habitId]/logs" />
        <Stack.Screen name="routines/index" />
        <Stack.Screen name="routines/new" />
        <Stack.Screen name="routines/edit" />
        <Stack.Screen name="routines/[routineId]" />
        <Stack.Screen name="routines/run" />
        <Stack.Screen name="tasks/new" />
        <Stack.Screen name="tasks/[taskId]/edit" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppProviders>
          <NotificationLifecycle />
          <StatusBar style="dark" />
          <AppRoutes />
        </AppProviders>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
