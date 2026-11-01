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
import { signUpSchema, type SignUpInput } from '../../features/auth/auth-schemas';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, ownerTokenAvailable } = useAuth();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });
  const submit = form.handleSubmit(
    async ({ fullName, email, password }) => {
      setError(null);
      try {
        await signUp({ fullName, email, password });
        showToast('Account created.', 'success');
        router.replace('/today');
      } catch (cause) {
        setError(
          cause instanceof AuthServiceError
            ? cause.message
            : 'Could not create the account. Try again.',
        );
      }
    },
    (errors) => {
      if (errors.fullName) form.setFocus('fullName');
      else if (errors.email) form.setFocus('email');
      else if (errors.password) form.setFocus('password');
      else if (errors.confirmPassword) form.setFocus('confirmPassword');
    },
  );
  return (
    <ScreenLayout>
      <AuthBrand />
      <AppHeader
        title="Create your account"
        subtitle="Start building better habits."
        action={
          <IconButton
            accessibilityLabel="Sign up help"
            accessibilityHint="Shows a short explanation of creating your account."
            icon={<AppIcon name="help" size={20} color="#334155" />}
            onPress={() =>
              Alert.alert(
                'Create your account',
                'Only the private owner can create the first account.',
              )
            }
          />
        }
      />
      <FormTextField
        control={form.control}
        name="fullName"
        label="Full Name"
        placeholder="Your name"
        autoCapitalize="words"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => form.setFocus('email')}
      />
      <FormTextField
        control={form.control}
        name="email"
        label="Email"
        placeholder="you@example.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => form.setFocus('password')}
      />
      <FormTextField
        control={form.control}
        name="password"
        label="Password"
        placeholder="At least 12 characters"
        secure
        autoComplete="new-password"
        returnKeyType="next"
        onSubmitEditing={() => form.setFocus('confirmPassword')}
      />
      <FormTextField
        control={form.control}
        name="confirmPassword"
        label="Confirm Password"
        placeholder="Re-enter your password"
        secure
        autoComplete="new-password"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {!ownerTokenAvailable ? (
        <View className="mb-4">
          <FormMessage
            message="Complete private owner setup before creating the account."
            tone="info"
          />
          <Button
            title="Set up owner access"
            variant="quiet"
            onPress={() => router.push('/setup')}
          />
        </View>
      ) : null}
      {error ? (
        <View className="mb-4">
          <FormMessage message={error} />
        </View>
      ) : null}
      <Button
        title="Create Account"
        loading={form.formState.isSubmitting}
        disabled={!form.formState.isValid || !ownerTokenAvailable}
        onPress={() => void submit()}
      />
      <View className="mt-auto pt-8">
        <Text className="text-center text-base text-slate-600">
          Already have an account?{' '}
          <Text
            accessibilityRole="link"
            onPress={() => router.replace('/sign-in')}
            className="font-semibold text-primary"
          >
            Sign in
          </Text>
        </Text>
      </View>
    </ScreenLayout>
  );
}
