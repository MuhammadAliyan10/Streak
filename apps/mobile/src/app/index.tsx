import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button } from '../components/ui/button';
import { ErrorState } from '../components/ui/feedback-state';
import { ScreenLayout } from '../components/layout/screen-layout';
import { useAuth } from '../features/auth/auth-context';

export default function IndexRoute() {
  const { status, ownerTokenAvailable, error, retry } = useAuth();
  const router = useRouter();
  if (status === 'loading')
    return (
      <ScreenLayout>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#4F46E5" size="large" />
          <Text className="mt-4 text-slate-600">Checking your session…</Text>
        </View>
      </ScreenLayout>
    );
  if (status === 'authenticated') return <Redirect href="/today" />;
  if (status === 'offline')
    return (
      <ScreenLayout>
        <ErrorState
          message={
            error ??
            'Your saved session could not be verified. Connect to the internet and try again.'
          }
          onRetry={() => void retry()}
        />
        <View className="mt-4">
          <Button
            title="Go to sign in"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        </View>
      </ScreenLayout>
    );
  return <Redirect href={ownerTokenAvailable ? '/sign-in' : '/setup'} />;
}
