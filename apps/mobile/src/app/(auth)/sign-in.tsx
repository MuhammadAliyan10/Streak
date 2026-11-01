import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { Alert, Text, View } from 'react-native';
import { Button, IconButton } from '../../components/ui/button';
import { AppIcon } from '../../components/ui/app-icon';
import { FormMessage } from '../../components/ui/form-message';
import { FormTextField } from '../../components/ui/form-text-field';
import { ScreenLayout } from '../../components/layout/screen-layout';
import { useToast } from '../../components/feedback/toast-provider';
import { AuthServiceError } from '../../features/auth/auth-service';
import { useAuth } from '../../features/auth/auth-context';
import { AuthBrand } from '../../features/auth/auth-brand';
import { AppHeader } from '../../components/layout/app-header';
import { signInSchema, type SignInInput } from '../../features/auth/auth-schemas';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  });
  const submit = form.handleSubmit(
    async (values) => {
      setError(null);
      try {
        await signIn({ email: values.email, password: values.password });
        showToast('Signed in.', 'success');
        router.replace('/today');
      } catch (cause) {
        setError(
          cause instanceof AuthServiceError ? cause.message : 'Could not sign in. Try again.',
        );
      }
    },
    (errors) => {
      if (errors.email) form.setFocus('email');
      else if (errors.password) form.setFocus('password');
    },
  );
  return (
    <ScreenLayout>
      <AuthBrand />
      <AppHeader
        title="Welcome back"
        subtitle="Sign in to continue your progress."
        action={
          <IconButton
            accessibilityLabel="Sign in help"
            accessibilityHint="Shows a short explanation of signing in."
            icon={<AppIcon name="help" size={20} color="#334155" />}
            onPress={() =>
              Alert.alert('Sign in to Streak', 'Use the email and password for your owner account.')
            }
          />
        }
      />
      <FormTextField
        control={form.control}
        name="email"
        label="Email"
        placeholder="you@example.com"
        keyboardType="email-address"
        autoComplete="off"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => form.setFocus('password')}
      />
      <FormTextField
        control={form.control}
        name="password"
        label="Password"
        placeholder="Your password"
        secure
        autoComplete="password"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {error ? (
        <View className="mb-4">
          <FormMessage message={error} />
        </View>
      ) : null}
      <Button
        title="Sign In"
        loading={form.formState.isSubmitting}
        disabled={!form.formState.isValid}
        onPress={() => void submit()}
      />
      <View className="mt-auto pt-10">
        <Text className="text-center text-base text-slate-600">
          New to Streak?{' '}
          <Text
            accessibilityRole="link"
            onPress={() => router.push('/sign-up')}
            className="font-semibold text-primary"
          >
            Create an account
          </Text>
        </Text>
      </View>
    </ScreenLayout>
  );
}
