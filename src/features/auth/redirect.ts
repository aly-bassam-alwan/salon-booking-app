/**
 * Parse an auth deep link (password reset / email confirmation).
 *
 * With the PKCE flow, Supabase redirects to e.g.
 *   salonbookingapp://reset-password?code=...                (success)
 *   salonbookingapp://reset-password?error_code=otp_expired&… (failure)
 * Errors may also arrive in the URL fragment (#...), so both are read.
 */
export type AuthRedirect =
  | { kind: 'code'; code: string }
  | { kind: 'error'; errorCode: string | null; description: string | null }
  | { kind: 'none' };

export function parseAuthRedirect(url: string | null | undefined): AuthRedirect {
  if (!url) return { kind: 'none' };

  const [beforeHash, fragment = ''] = url.split('#');
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const hashParams = new URLSearchParams(fragment);
  const get = (name: string) => params.get(name) ?? hashParams.get(name);

  const code = get('code');
  if (code) return { kind: 'code', code };

  if (get('error') || get('error_code') || get('error_description')) {
    return { kind: 'error', errorCode: get('error_code'), description: get('error_description') };
  }
  return { kind: 'none' };
}
