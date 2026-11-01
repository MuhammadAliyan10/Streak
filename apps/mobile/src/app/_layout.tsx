import '../../global.css';
import { Stack } from 'expo-router';
import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary } from '../components/layout/app-error-boundary';
import { AppProviders } from '../providers/app-providers';
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

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppProviders>
          <NotificationLifecycle />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name="focus/session"
              options={{
                presentation: 'fullScreenModal',
                gestureEnabled: false,
                animation: 'fade',
              }}
            />
          </Stack>
        </AppProviders>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
