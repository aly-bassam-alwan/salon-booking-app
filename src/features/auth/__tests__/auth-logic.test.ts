import { readSupabaseEnv } from '@/lib/env';

import { authErrorMessage } from '../auth-errors';
import { parseAuthRedirect } from '../redirect';
import { homeHrefForRole } from '../routing';
import {
  MIN_PASSWORD_LENGTH,
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from '../schemas';

describe('readSupabaseEnv', () => {
  it('returns the URL and anon key', () => {
    expect(readSupabaseEnv({ url: 'https://abc.supabase.co', anonKey: 'anon' })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: 'anon',
    });
  });

  it.each([
    [{ url: undefined, anonKey: 'anon' }, 'EXPO_PUBLIC_SUPABASE_URL'],
    [{ url: 'https://abc.supabase.co', anonKey: '' }, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'],
  ])('explains which variable is missing (%#)', (env, name) => {
    expect(() => readSupabaseEnv(env)).toThrow(name);
    expect(() => readSupabaseEnv(env)).toThrow('.env.example');
  });

  it('rejects a URL that is not http(s)', () => {
    expect(() => readSupabaseEnv({ url: 'abc.supabase.co', anonKey: 'anon' })).toThrow(
      'EXPO_PUBLIC_SUPABASE_URL',
    );
  });
});

describe('schemas', () => {
  it('requires a valid email and a password to sign in', () => {
    expect(signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(signInSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(signInSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('trims and lower-cases the email', () => {
    const result = signInSchema.parse({ email: '  Ali@Example.COM ', password: 'x' });
    expect(result.email).toBe('ali@example.com');
  });

  it(`requires at least ${MIN_PASSWORD_LENGTH} characters and a matching confirmation to sign up`, () => {
    const valid = {
      fullName: 'Ali',
      email: 'a@b.co',
      password: 'longenough',
      confirmPassword: 'longenough',
    };
    expect(signUpSchema.safeParse(valid).success).toBe(true);
    expect(
      signUpSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success,
    ).toBe(false);

    const mismatch = signUpSchema.safeParse({ ...valid, confirmPassword: 'different!' });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('requires a name to sign up', () => {
    expect(
      signUpSchema.safeParse({
        fullName: ' ',
        email: 'a@b.co',
        password: 'longenough',
        confirmPassword: 'longenough',
      }).success,
    ).toBe(false);
  });

  it('validates forgot-password and new-password forms', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false);
    expect(
      newPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' })
        .success,
    ).toBe(true);
    expect(
      newPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'nope' }).success,
    ).toBe(false);
  });
});

describe('authErrorMessage', () => {
  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['email_not_confirmed', 'Please confirm your email first. Check your inbox for the link.'],
    ['over_email_send_rate_limit', 'Too many emails were sent. Please wait a while and try again.'],
    ['over_request_rate_limit', 'Too many attempts. Please wait a moment and try again.'],
    [
      'weak_password',
      `Please choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`,
    ],
    ['same_password', 'Your new password must be different from the old one.'],
  ])('maps %s', (code, message) => {
    expect(authErrorMessage({ code, message: 'raw' })).toBe(message);
  });

  it('explains the built-in email restriction (team members only)', () => {
    expect(authErrorMessage({ code: 'email_address_not_authorized', message: 'raw' })).toContain(
      'team members',
    );
  });

  it('falls back to a generic message without leaking raw errors', () => {
    expect(authErrorMessage({ code: 'unexpected_failure', message: 'stack trace...' })).toBe(
      'Something went wrong. Please try again.',
    );
    expect(authErrorMessage(new Error('Network request failed'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('homeHrefForRole', () => {
  it.each([
    ['customer', '/customer'],
    ['barber', '/barber'],
    ['admin', '/admin'],
  ] as const)('sends a %s to %s', (role, href) => {
    expect(homeHrefForRole(role)).toBe(href);
  });
});

describe('parseAuthRedirect', () => {
  it('reads the PKCE code from a deep link', () => {
    expect(parseAuthRedirect('salonbookingapp://reset-password?code=abc123')).toEqual({
      kind: 'code',
      code: 'abc123',
    });
  });

  it('works with Expo Go URLs', () => {
    expect(parseAuthRedirect('exp://u-abc.exp.direct/--/reset-password?code=xyz')).toEqual({
      kind: 'code',
      code: 'xyz',
    });
  });

  it('reads errors from the query string or the fragment (expired links)', () => {
    expect(
      parseAuthRedirect(
        'salonbookingapp://reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({
      kind: 'error',
      errorCode: 'otp_expired',
      description: 'Email link is invalid or has expired',
    });
    expect(
      parseAuthRedirect(
        'salonbookingapp://reset-password#error=access_denied&error_code=otp_expired&error_description=Expired',
      ),
    ).toEqual({ kind: 'error', errorCode: 'otp_expired', description: 'Expired' });
  });

  it('returns none when the link has neither', () => {
    expect(parseAuthRedirect('salonbookingapp://reset-password')).toEqual({ kind: 'none' });
    expect(parseAuthRedirect(null)).toEqual({ kind: 'none' });
  });
});
