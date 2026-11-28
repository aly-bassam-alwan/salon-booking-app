import { z } from 'zod';

/**
 * Must match the Supabase Auth "minimum password length" setting
 * (supabase/config.jsonc locally, dashboard for the hosted project).
 * The server enforces it; this only gives faster feedback.
 */
export const MIN_PASSWORD_LENGTH = 8;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Please enter a valid email address.' }));

const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Please enter your password.'),
});

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Please enter your name.').max(100),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type SignInValues = z.infer<typeof signInSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;
