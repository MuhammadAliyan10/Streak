import '../../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppErrorBoundary } from '../components/layout/app-error-boundary';
import { AppProviders } from '../providers/app-providers';

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <AppProviders>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AppProviders>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
