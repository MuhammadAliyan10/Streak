import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ActivityIndicator, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/feedback-state';
import { FormMessage } from '../../components/ui/form-message';
import { FormTextField } from '../../components/ui/form-text-field';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { useToast } from '../../components/feedback/toast-provider';
import { initializeLocalDatabase } from '../../services/local-database';
import { syncLocalData } from '../../services/sync-service';
import {
  OwnerServiceError,
  disconnectOwner,
  getOwnerToken,
  rotateOwnerToken,
  verifyAndStoreOwnerToken,
  verifyStoredOwnerToken,
} from './owner-service';
import {
  ownerRotationSchema,
  ownerSetupSchema,
  type OwnerRotationInput,
  type OwnerSetupInput,
} from './owner-schemas';

type GateStatus = 'loading' | 'setup' | 'connected' | 'offline' | 'local';

function readableError(error: unknown): string {
  return error instanceof OwnerServiceError ? error.message : 'Something went wrong. Try again.';
}

export function OwnerGate() {
  const [status, setStatus] = useState<GateStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const [showRotation, setShowRotation] = useState(false);
  const { showToast } = useToast();

  const restore = useCallback(async () => {
    setStatus('loading');
    setMessage(null);
    try {
      const token = await getOwnerToken();
      if (!token) {
        setStatus('setup');
        return;
      }
      try {
        await verifyStoredOwnerToken();
        setStatus('connected');
      } catch (error) {
        if (error instanceof OwnerServiceError && error.code === 'unauthorized') {
          setStatus('setup');
          setMessage('The saved token was rejected. Enter the current owner token to reconnect.');
        } else {
          setStatus('offline');
          setMessage(readableError(error));
        }
      }
      setDatabase(await initializeLocalDatabase());
    } catch (error) {
      setStatus('setup');
      setMessage(readableError(error));
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const finishOwnerSetup = useCallback(async () => {
    await initializeLocalDatabase().then(setDatabase);
    setStatus('connected');
    setMessage(null);
  }, []);

  const onDisconnect = useCallback(async () => {
    try {
      await disconnectOwner();
      setStatus('setup');
      setShowRotation(false);
      setMessage(null);
      showToast('Owner token removed from this device.', 'success');
    } catch (error) {
      showToast(readableError(error), 'error');
    }
  }, [showToast]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!database) throw new Error('Local storage is still initializing.');
      return syncLocalData(database);
    },
    onSuccess: ({ uploaded, downloaded }) => {
      showToast(`Sync complete. ${uploaded} uploaded, ${downloaded} downloaded.`, 'success');
    },
    onError: (error) => {
      if (error instanceof OwnerServiceError && error.code === 'unauthorized') {
        setMessage(error.message);
        setStatus('setup');
      }
      showToast(readableError(error), 'error');
    },
  });

  if (status === 'loading') {
    return (
      <ScreenLayout>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text className="mt-4 text-sm text-slate-600">Checking private access…</Text>
        </View>
      </ScreenLayout>
    );
  }

  if (status === 'setup') {
    return <OwnerSetup message={message} onSuccess={finishOwnerSetup} />;
  }

  if (status === 'offline') {
    return (
      <ScreenLayout>
        <Header />
        <View className="mt-8">
          <ErrorState
            message={
              message ??
              'The saved token is stored securely, but Neon could not verify it. Cloud data remains locked until the server responds.'
            }
            onRetry={() => void restore()}
          />
          <Button title="Continue offline" variant="secondary" onPress={() => setStatus('local')} />
          <View className="mt-4">
            <Button title="Enter owner token" variant="quiet" onPress={() => setStatus('setup')} />
          </View>
        </View>
      </ScreenLayout>
    );
  }

  if (status === 'local') {
    return (
      <ScreenLayout>
        <Header />
        <View className="mt-8 self-start rounded-full bg-amber-50 px-3 py-2">
          <Text className="text-sm font-medium text-amber-900">Offline · server not verified</Text>
        </View>
        <View className="mt-4">
          <Text className="text-2xl font-bold text-ink">Local mode</Text>
          <Text className="mt-2 text-base leading-6 text-slate-600">
            Your local SQLite data remains available. Neon data is locked until the stored token is
            verified online.
          </Text>
        </View>
        <View className="mt-6">
          <LocalReady />
        </View>
        <View className="mt-4">
          <Button title="Check connection" variant="secondary" onPress={() => void restore()} />
          <View className="mt-3">
            <Button title="Enter owner token" variant="quiet" onPress={() => setStatus('setup')} />
          </View>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <Header />
      <View className="mt-8">
        <View className="mb-5 flex-row items-center rounded-full bg-emerald-50 px-3 py-2 self-start">
          <View className="mr-2 h-2 w-2 rounded-full bg-emerald-600" />
          <Text className="text-sm font-medium text-emerald-900">
            Private owner access connected
          </Text>
        </View>
        <Text className="text-2xl font-bold text-ink">Your personal workspace</Text>
        <Text className="mt-2 text-base leading-6 text-slate-600">
          Streak is ready for your personal productivity tools. No activity data has been added in
          this foundation.
        </Text>
      </View>

      <View className="mt-8">
        {database ? (
          <Button
            title="Sync now"
            loading={syncMutation.isPending}
            onPress={() => syncMutation.mutate()}
          />
        ) : (
          <Button title="Preparing local storage" loading disabled onPress={() => undefined} />
        )}
        <View className="mt-3">
          <Button
            title={showRotation ? 'Close token rotation' : 'Rotate owner token'}
            variant="secondary"
            onPress={() => setShowRotation((visible) => !visible)}
          />
        </View>
        {showRotation ? <OwnerRotation onSuccess={() => setShowRotation(false)} /> : null}
        <View className="mt-3">
          <Button
            title="Remove token from this device"
            variant="quiet"
            onPress={() => void onDisconnect()}
          />
        </View>
      </View>

      <View className="mt-8">
        {database ? (
          <EmptyState
            title="Local storage is ready"
            message="Offline operations will stay on this device until a successful sync acknowledges them."
          />
        ) : (
          <FormMessage
            message="Local storage is still opening. You can retry by leaving and reopening this screen."
            tone="info"
          />
        )}
      </View>
    </ScreenLayout>
  );
}

function Header() {
  return (
    <View className="mt-3">
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-light">
        <View className="h-5 w-5 rounded-full border-4 border-primary" />
      </View>
      <Text className="mt-4 text-3xl font-bold tracking-tight text-ink">Streak</Text>
      <Text className="mt-1 text-base text-slate-600">A steady start.</Text>
    </View>
  );
}

function OwnerSetup({
  message,
  onSuccess,
}: {
  message: string | null;
  onSuccess: () => Promise<void>;
}) {
  const form = useForm<OwnerSetupInput>({
    resolver: zodResolver(ownerSetupSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { ownerToken: '' },
  });
  const [requestError, setRequestError] = useState<string | null>(message);
  const { showToast } = useToast();

  const submit = form.handleSubmit(async ({ ownerToken }) => {
    setRequestError(null);
    try {
      await verifyAndStoreOwnerToken(ownerToken);
      await onSuccess();
      showToast('Private owner access verified.', 'success');
    } catch (error) {
      if (error instanceof OwnerServiceError && error.code === 'unauthorized') {
        form.setError('ownerToken', { message: error.message });
      } else {
        setRequestError(readableError(error));
      }
    }
  });

  return (
    <ScreenLayout>
      <Header />
      <View className="mt-10">
        <Text className="text-2xl font-bold text-ink">Set up private access</Text>
        <Text className="mt-2 text-base leading-6 text-slate-600">
          Enter the owner token generated outside the app. Streak verifies it with Neon before
          saving it to SecureStore.
        </Text>
      </View>
      <View className="mt-8">
        <FormTextField
          control={form.control}
          name="ownerToken"
          label="Owner token"
          placeholder="Paste your generated token"
          secure
          autoComplete="off"
          returnKeyType="done"
        />
        {requestError ? <FormMessage message={requestError} /> : null}
        <Button
          title="Verify and continue"
          loading={form.formState.isSubmitting}
          disabled={!form.formState.isValid}
          onPress={() => void submit()}
        />
        <Text className="mt-4 text-xs leading-5 text-slate-500">
          Generate a 256-bit token with `pnpm owner-token:generate`. Keep it private; the app does
          not send it anywhere except your Neon Function over HTTPS.
        </Text>
      </View>
    </ScreenLayout>
  );
}

function OwnerRotation({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<OwnerRotationInput>({
    resolver: zodResolver(ownerRotationSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { nextToken: '' },
  });
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const submit = form.handleSubmit(async ({ nextToken }) => {
    setError(null);
    try {
      await rotateOwnerToken(nextToken);
      onSuccess();
      showToast('Owner token rotated.', 'success');
    } catch (cause) {
      if (cause instanceof OwnerServiceError && cause.code === 'unauthorized') {
        form.setError('nextToken', {
          message: 'The current owner token was rejected. Reconnect with the active token first.',
        });
      } else {
        setError(readableError(cause));
      }
    }
  });

  return (
    <View className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <Text className="mb-3 text-base font-semibold text-ink">Enter a new generated token</Text>
      <Text className="mb-3 text-sm leading-5 text-slate-600">
        Generate one with `pnpm owner-token:generate --next`, then paste it here. The current token
        remains active until Neon confirms rotation.
      </Text>
      <FormTextField
        control={form.control}
        name="nextToken"
        label="New owner token"
        secure
        autoComplete="off"
      />
      {error ? <FormMessage message={error} /> : null}
      <Button
        title="Rotate token"
        loading={form.formState.isSubmitting}
        disabled={!form.formState.isValid}
        onPress={() => void submit()}
      />
    </View>
  );
}

function LocalReady() {
  return (
    <View className="mt-5">
      <EmptyState
        title="Local storage is ready"
        message="Offline changes stay on this device until the owner token can be verified online."
      />
    </View>
  );
}
