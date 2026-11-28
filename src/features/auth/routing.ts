import type { Database } from '@/types/database';

export type UserRole = Database['public']['Enums']['user_role'];

/** Where each role lands after signing in. */
export function homeHrefForRole(role: UserRole): '/customer' | '/barber' | '/admin' {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'barber':
      return '/barber';
    case 'customer':
      return '/customer';
  }
}
