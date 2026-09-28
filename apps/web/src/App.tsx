import { useEffect, useState, type ReactNode } from 'react';
import { AcceptInvitation } from './AcceptInvitation.tsx';
import { api, isNetworkError, type CurrentUser } from './api.ts';
import { AppShell } from './AppShell.tsx';
import { OfflineProvider } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { RecoverAccount } from './RecoverAccount.tsx';
import { navigate, parseRoute, usePathname } from './router.tsx';
import { SignIn } from './SignIn.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import { t } from './i18n/index.ts';

/** Pages reachable without signing in (sign-in, invitation and recovery links). */
function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="app-main" style={{ maxWidth: '36rem' }}>
      <h1>VergissMeinNicht</h1>
      <p className="muted">{t('public.tagline')}</p>
      <div className="card">{children}</div>
      <SourceFooter />
    </main>
  );
}

export function App() {
  const route = parseRoute(usePathname());
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  // Offline data of another account that used this browser is never kept (let alone sent) (8.5).
  const userId = user?.id;
  useEffect(() => {
    if (userId !== undefined) void offlineStore.discardOtherUsers(userId);
  }, [userId]);

  useEffect(() => {
    let active = true;
    api.currentUser().then(
      (current) => {
        if (!active) return;
        setUser(current);
        if (current !== null) void offlineStore.saveUser(current);
      },
      async (caught: unknown) => {
        // Server unreachable (e.g. the router is off): continue as the last user of this browser, with
        // the Runs saved here; the session is checked again with the first request that gets through (8.5).
        const last = isNetworkError(caught) ? await offlineStore.lastUser() : undefined;
        if (active) setUser(last ?? null);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (route.page === 'invite') {
    return (
      <PublicLayout>
        <AcceptInvitation token={route.token} />
      </PublicLayout>
    );
  }
  if (route.page === 'recover') {
    return (
      <PublicLayout>
        <RecoverAccount token={route.token} />
      </PublicLayout>
    );
  }
  if (user === undefined) return <p className="app-main">{t('common.loading')}</p>;
  if (user === null) {
    return (
      <PublicLayout>
        {/* The Knot token stays in the address bar; after sign-in the app resolves it. */}
        {route.page === 'knot' && <p role="status">{t('knot.signInHint')}</p>}
        <SignIn
          onSignedIn={(signedIn) => {
            setUser(signedIn);
            void offlineStore.saveUser(signedIn);
          }}
        />
      </PublicLayout>
    );
  }
  return (
    <OfflineProvider key={user.id} userId={user.id}>
      <AppShell
        user={user}
        route={route}
        onSignOut={() => {
          // Nothing of this account stays on the device (saved Runs, unsent changes).
          void api
            .signOut()
            .catch(() => undefined)
            .then(() => offlineStore.clear())
            .then(() => {
              setUser(null);
              navigate('/', { replace: true });
            });
        }}
      />
    </OfflineProvider>
  );
}
