import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// The real route tree (src/app) with a fake Supabase client: proves each role
// lands in its own area and that guarded areas can't be opened by others.

type FakeUser = { id: string; email: string; role: 'customer' | 'barber' | 'admin' } | null;
const mockCurrentUser: { value: FakeUser } = { value: null };

jest.mock('@/lib/supabase', () => {
  const session = () =>
    mockCurrentUser.value
      ? { user: { id: mockCurrentUser.value.id, email: mockCurrentUser.value.email } }
      : null;
  return {
    supabase: {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: session() }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(async () => ({ error: null })),
      },
      from: jest.fn(() => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              mockCurrentUser.value
                ? { data: { role: mockCurrentUser.value.role }, error: null }
                : { data: null, error: { message: 'no user' } },
          }),
        }),
      })),
    },
  };
});

jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hide: jest.fn() }));

async function openApp(initialUrl = '/') {
  await renderRouter('./src/app', { initialUrl });
}

describe('role-based routing', () => {
  it('sends a signed-out user to sign-in', async () => {
    mockCurrentUser.value = null;
    await openApp();
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  });

  it.each([
    ['customer', '/customer'],
    ['barber', '/barber'],
    ['admin', '/admin'],
  ] as const)('sends a %s to %s', async (role, path) => {
    mockCurrentUser.value = { id: `${role}-id`, email: `${role}@example.com`, role };
    await openApp();
    await waitFor(() => expect(screen).toHavePathname(path));
  });

  it('keeps a customer out of the admin area', async () => {
    mockCurrentUser.value = { id: 'c', email: 'c@example.com', role: 'customer' };
    await openApp('/admin');
    await waitFor(() => expect(screen).toHavePathname('/customer'));
  });

  it('keeps a signed-out user out of the customer area', async () => {
    mockCurrentUser.value = null;
    await openApp('/customer');
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  });

  it('sends a signed-in user away from sign-in to their area', async () => {
    mockCurrentUser.value = { id: 'b', email: 'b@example.com', role: 'barber' };
    await openApp('/sign-in');
    await waitFor(() => expect(screen).toHavePathname('/barber'));
  });

  it('lets anyone open the reset-password deep link', async () => {
    mockCurrentUser.value = null;
    await openApp('/reset-password');
    await waitFor(() => expect(screen).toHavePathname('/reset-password'));
  });
});
