import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { supabase } from '@/lib/supabase';

import { ForgotPasswordScreen } from '../screens/forgot-password-screen';
import { ResetPasswordScreen } from '../screens/reset-password-screen';
import { SignInScreen } from '../screens/sign-in-screen';
import { SignUpScreen } from '../screens/sign-up-screen';

// ------------------------------------------------------------------ mocks
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

const mockReplace = jest.fn();
const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    router: { replace: (href: string) => mockReplace(href), push: jest.fn() },
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    useLocalSearchParams: () => mockParams.current,
  };
});

const mockLinkingUrl: { current: string | null } = { current: null };
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `salonbookingapp://${path}`,
  useLinkingURL: () => mockLinkingUrl.current,
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = {};
  mockLinkingUrl.current = null;
});

async function type(label: string, text: string) {
  await fireEvent.changeText(screen.getByLabelText(label), text);
}
async function press(label: string) {
  await fireEvent.press(screen.getByRole('button', { name: label }));
}

// ----------------------------------------------------------------- sign-in
describe('SignInScreen', () => {
  it('signs in with the trimmed, lower-cased email', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await render(<SignInScreen />);

    await type('Email', '  Ali@Example.com ');
    await type('Password', 'secret-password');
    await press('Sign in');

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'ali@example.com',
        password: 'secret-password',
      }),
    );
  });

  it('shows a friendly message for wrong credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    await render(<SignInScreen />);

    await type('Email', 'ali@example.com');
    await type('Password', 'wrong');
    await press('Sign in');

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
  });

  it('validates before calling Supabase', async () => {
    await render(<SignInScreen />);
    await type('Email', 'not-an-email');
    await press('Sign in');

    expect(await screen.findByText('Please enter a valid email address.')).toBeTruthy();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------- sign-up
describe('SignUpScreen', () => {
  async function fillSignUp() {
    await type('Full name', 'Ali Bassam');
    await type('Email', 'ali@example.com');
    await type('Password', 'longenough');
    await type('Confirm password', 'longenough');
  }

  it('passes the name as metadata and the confirmation deep link', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null });
    await render(<SignUpScreen />);
    await fillSignUp();
    await press('Create account');

    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith({
        email: 'ali@example.com',
        password: 'longenough',
        options: {
          data: { full_name: 'Ali Bassam' },
          emailRedirectTo: 'salonbookingapp://auth/callback',
        },
      }),
    );
    expect(await screen.findByText(/We sent a confirmation link to ali@example.com/)).toBeTruthy();
  });

  it('never sends a role in the sign-up metadata', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null });
    await render(<SignUpScreen />);
    await fillSignUp();
    await press('Create account');

    await waitFor(() => expect(auth.signUp).toHaveBeenCalled());
    expect(JSON.stringify(auth.signUp.mock.calls[0][0])).not.toContain('role');
  });

  it('rejects a short password without calling Supabase', async () => {
    await render(<SignUpScreen />);
    await type('Full name', 'Ali');
    await type('Email', 'ali@example.com');
    await type('Password', 'short');
    await type('Confirm password', 'short');
    await press('Create account');

    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------- forgot-password
describe('ForgotPasswordScreen', () => {
  it('sends the reset email with the reset-password deep link', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await render(<ForgotPasswordScreen />);
    await type('Email', 'ali@example.com');
    await press('Send reset link');

    await waitFor(() =>
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ali@example.com', {
        redirectTo: 'salonbookingapp://reset-password',
      }),
    );
  });

  it('shows the same message whether or not the account exists (no enumeration)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await render(<ForgotPasswordScreen />);
    await type('Email', 'nobody@example.com');
    await press('Send reset link');

    expect(
      await screen.findByText(/If an account exists for that email, we've sent a link/),
    ).toBeTruthy();
  });

  it('shows rate-limit errors (they say nothing about the account)', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
    });
    await render(<ForgotPasswordScreen />);
    await type('Email', 'ali@example.com');
    await press('Send reset link');

    expect(await screen.findByText(/Too many emails were sent/)).toBeTruthy();
  });
});

// ---------------------------------------------------------- reset-password
describe('ResetPasswordScreen', () => {
  it('exchanges the code from the link once, then sets the new password', async () => {
    mockParams.current = { code: 'one-time-code' };
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    auth.updateUser.mockResolvedValue({ data: {}, error: null });

    await render(<ResetPasswordScreen />);
    await waitFor(() => expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code'));

    await type('New password', 'brand-new-password');
    await type('Confirm password', 'brand-new-password');
    await press('Save new password');

    await waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'brand-new-password' }),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Your password has been changed/)).toBeTruthy();
  });

  it('shows a friendly message and a way to request a new link when the link expired', async () => {
    mockLinkingUrl.current =
      'salonbookingapp://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    await render(<ResetPasswordScreen />);

    expect(
      await screen.findByText('This link has expired. Please request a new one.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeTruthy();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('explains a link opened on another device', async () => {
    mockParams.current = { code: 'code-from-other-device' };
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'flow_state_not_found', message: 'invalid flow state' },
    });
    await render(<ResetPasswordScreen />);

    expect(
      await screen.findByText(/only be used on the device where you requested it/),
    ).toBeTruthy();
  });

  it('treats a link without a code as invalid', async () => {
    await render(<ResetPasswordScreen />);
    expect(await screen.findByText(/This reset link is invalid/)).toBeTruthy();
  });

  it('shows the server error when the new password is rejected', async () => {
    mockParams.current = { code: 'one-time-code' };
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    auth.updateUser.mockResolvedValue({
      data: {},
      error: { code: 'same_password', message: 'New password should be different' },
    });
    await render(<ResetPasswordScreen />);
    await waitFor(() => expect(auth.exchangeCodeForSession).toHaveBeenCalled());

    await type('New password', 'old-password-1');
    await type('Confirm password', 'old-password-1');
    await press('Save new password');

    expect(
      await screen.findByText('Your new password must be different from the old one.'),
    ).toBeTruthy();
  });
});
