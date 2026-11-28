import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

import { authErrorMessage } from '../auth-errors';
import { ControlledField, newPasswordInputProps } from '../controlled-field';
import { newPasswordSchema } from '../schemas';
import { useAuthRedirect, useCodeExchange } from '../use-auth-link';

const INVALID_LINK = 'This reset link is invalid or has expired. Please request a new one.';

/** Opened from the password-reset email: salonbookingapp://reset-password?code=… */
export function ResetPasswordScreen() {
  const redirect = useAuthRedirect();
  const exchange = useCodeExchange(redirect.kind === 'code' ? redirect.code : null);

  if (redirect.kind === 'error') {
    const message = redirect.errorCode ? authErrorMessage({ code: redirect.errorCode }) : null;
    return (
      <LinkProblem message={message && !message.startsWith('Something') ? message : INVALID_LINK} />
    );
  }
  if (redirect.kind === 'none') return <LinkProblem message={INVALID_LINK} />;
  if (exchange.status === 'error')
    return <LinkProblem message={authErrorMessage(exchange.error)} />;
  if (exchange.status === 'pending') {
    return (
      <FormScreen title="Reset your password">
        <ThemedText accessibilityLiveRegion="polite">Checking your link…</ThemedText>
      </FormScreen>
    );
  }
  return <NewPasswordForm />;
}

function NewPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { control, handleSubmit, formState } = useForm<
    z.input<typeof newPasswordSchema>,
    unknown,
    z.output<typeof newPasswordSchema>
  >({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }
    setDone(true);
  });

  if (done) {
    return (
      <FormScreen title="Password changed">
        <FormMessage tone="success">
          Your password has been changed. You&apos;re signed in.
        </FormMessage>
        <Button title="Continue" onPress={() => router.replace('/')} />
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Choose a new password">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <ControlledField
        control={control}
        name="password"
        label="New password"
        {...newPasswordInputProps}
      />
      <ControlledField
        control={control}
        name="confirmPassword"
        label="Confirm password"
        {...newPasswordInputProps}
        onSubmitEditing={() => void onSubmit()}
      />
      <Button title="Save new password" onPress={onSubmit} loading={formState.isSubmitting} />
    </FormScreen>
  );
}

function LinkProblem({ message }: { message: string }) {
  return (
    <FormScreen title="Reset your password">
      <FormMessage tone="error">{message}</FormMessage>
      <Button title="Send a new link" onPress={() => router.replace('/forgot-password')} />
    </FormScreen>
  );
}
