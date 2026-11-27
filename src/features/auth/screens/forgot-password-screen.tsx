import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

import { authErrorMessage } from '../auth-errors';
import { ControlledField, emailInputProps } from '../controlled-field';
import { forgotPasswordSchema } from '../schemas';

export function ForgotPasswordScreen() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { control, handleSubmit, formState } = useForm<
    z.input<typeof forgotPasswordSchema>,
    unknown,
    z.output<typeof forgotPasswordSchema>
  >({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // Opens reset-password in the app. Must be in the Supabase redirect URLs.
      redirectTo: Linking.createURL('reset-password'),
    });
    if (resetError) {
      // Rate limits and email-sending problems: nothing about the account itself.
      setError(authErrorMessage(resetError));
      return;
    }
    setSent(true);
  });

  return (
    <FormScreen
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to choose a new password."
    >
      {sent ? (
        // The same message whether or not the account exists (no user enumeration).
        <FormMessage tone="success">
          If an account exists for that email, we&apos;ve sent a link to reset your password. Open
          it on this phone.
        </FormMessage>
      ) : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <ControlledField
        control={control}
        name="email"
        label="Email"
        {...emailInputProps}
        onSubmitEditing={() => void onSubmit()}
      />
      <Button title="Send reset link" onPress={onSubmit} loading={formState.isSubmitting} />
      <Link href="/sign-in">
        <ThemedText type="linkPrimary">Back to sign in</ThemedText>
      </Link>
    </FormScreen>
  );
}
