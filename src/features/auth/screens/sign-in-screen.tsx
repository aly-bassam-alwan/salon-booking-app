import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

import { authErrorMessage } from '../auth-errors';
import { ControlledField, emailInputProps } from '../controlled-field';
import { signInSchema } from '../schemas';

export function SignInScreen() {
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<
    z.input<typeof signInSchema>,
    unknown,
    z.output<typeof signInSchema>
  >({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    // On success the AuthProvider sees the new session and routing takes over.
    if (signInError) setError(authErrorMessage(signInError));
  });

  return (
    <FormScreen title="Sign in" subtitle="Welcome back. Sign in to book your next appointment.">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <ControlledField control={control} name="email" label="Email" {...emailInputProps} />
      <ControlledField
        control={control}
        name="password"
        label="Password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => void onSubmit()}
      />
      <Button title="Sign in" onPress={onSubmit} loading={formState.isSubmitting} />
      <Link href="/forgot-password">
        <ThemedText type="linkPrimary">Forgot password?</ThemedText>
      </Link>
      <Link href="/sign-up">
        <ThemedText type="linkPrimary">New here? Create an account</ThemedText>
      </Link>
    </FormScreen>
  );
}
