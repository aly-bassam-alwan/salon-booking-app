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
import { ControlledField, emailInputProps, newPasswordInputProps } from '../controlled-field';
import { MIN_PASSWORD_LENGTH, signUpSchema } from '../schemas';

export function SignUpScreen() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<
    z.input<typeof signUpSchema>,
    unknown,
    z.output<typeof signUpSchema>
  >({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ fullName, email, password }) => {
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Copied into public.profiles by the DB trigger. The role is NEVER
        // sent: every sign-up is a customer, set by the database.
        data: { full_name: fullName },
        emailRedirectTo: Linking.createURL('auth/callback'),
      },
    });
    if (signUpError) {
      setError(authErrorMessage(signUpError));
      return;
    }
    // With "Confirm email" on there is no session yet. With it off, the
    // AuthProvider picks up the session and routing takes over.
    if (!data.session) setSentTo(email);
  });

  if (sentTo) {
    return (
      <FormScreen title="Check your email">
        <FormMessage tone="success">
          We sent a confirmation link to {sentTo}. Open it on this phone to finish creating your
          account.
        </FormMessage>
        <Link href="/sign-in">
          <ThemedText type="linkPrimary">Back to sign in</ThemedText>
        </Link>
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Create an account" subtitle="Book haircuts and manage your appointments.">
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <ControlledField
        control={control}
        name="fullName"
        label="Full name"
        autoComplete="name"
        textContentType="name"
      />
      <ControlledField control={control} name="email" label="Email" {...emailInputProps} />
      <ControlledField
        control={control}
        name="password"
        label="Password"
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        {...newPasswordInputProps}
      />
      <ControlledField
        control={control}
        name="confirmPassword"
        label="Confirm password"
        {...newPasswordInputProps}
        onSubmitEditing={() => void onSubmit()}
      />
      <Button title="Create account" onPress={onSubmit} loading={formState.isSubmitting} />
      <Link href="/sign-in">
        <ThemedText type="linkPrimary">Already have an account? Sign in</ThemedText>
      </Link>
    </FormScreen>
  );
}
