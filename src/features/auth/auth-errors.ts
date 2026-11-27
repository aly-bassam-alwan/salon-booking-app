import { MIN_PASSWORD_LENGTH } from './schemas';

/**
 * Friendly messages for Supabase Auth error codes (AuthError.code).
 * Unknown errors get a generic message, so raw server text is never shown.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Please confirm your email first. Check your inbox for the link.',
  over_email_send_rate_limit: 'Too many emails were sent. Please wait a while and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  weak_password: `Please choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`,
  same_password: 'Your new password must be different from the old one.',
  email_address_not_authorized:
    "This project can't email that address yet. Supabase's built-in email only sends to the project's team members until custom SMTP is set up.",
  otp_expired: 'This link has expired. Please request a new one.',
  flow_state_not_found:
    'This link can only be used on the device where you requested it. Please request a new one here.',
  flow_state_expired: 'This link has expired. Please request a new one.',
  bad_code_verifier:
    'This link can only be used on the device where you requested it. Please request a new one here.',
  signup_disabled: 'New sign-ups are currently disabled.',
};

const GENERIC = 'Something went wrong. Please try again.';

export function authErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : null;
  return (code && MESSAGES[code]) || GENERIC;
}
