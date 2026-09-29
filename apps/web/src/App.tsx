import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AcceptInvitation } from './AcceptInvitation.tsx';
import { api, isNetworkError, type CurrentUser } from './api.ts';
import { AppShell } from './AppShell.tsx';
import { OfflineProvider } from './offline/OfflineProvider.tsx';
import { announceSession, onSessionMessage, reactionTo } from './offline/session-channel.ts';
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
      <h1 className="public-brand">
        <img className="brand-icon" src="/icon.svg" alt="" width={40} height={40} />
        VergissMeinNicht
      </h1>
      <p className="muted">{t('public.tagline')}</p>
      <div className="card">{children}</div>
      <SourceFooter />
    </main>
  );
}

export function App() {
  const route = parseRoute(usePathname());
  const [user, setUserState] = useState<CurrentUser | null | undefined>(undefined);
  const [cleanupFailed, setCleanupFailed] = useState(false);

  // Device storage is usable only while an account is known; it is suspended before any view of the
  // next account renders, so nothing of the previous account is read or re-created (13.1).
  const setUser = useCallback((next: CurrentUser | null) => {
    if (next === null) offlineStore.suspend();
    else offlineStore.resume();
    setUserState(next);
  }, []);

  // Offline data of another account that used this browser is never kept (let alone sent) (8.5).
  const userId = user?.id;
  useEffect(() => {
    if (userId !== undefined) void offlineStore.discardOtherUsers(userId);
  }, [userId]);

  // Another tab signed out or another account signed in: leave this account here at once (the
  // cookie is shared), so its queued changes are never sent under someone else's session (13.1).
  useEffect(
    () =>
      onSessionMessage((message) => {
        const reaction = reactionTo(message, userId);
        if (reaction === 'leave') {
          setUser(null);
          navigate('/', { replace: true });
        } else if (reaction === 'recheck') {
          offlineStore.suspend();
          api.currentUser().then(
            (current) => setUser(current),
            // Could not check (offline, busy server): stay on the sign-in page until the next request tells.
            () => setUser(null),
          );
        }
      }),
    [userId, setUser],
  );

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
  }, [setUser]);

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
        {cleanupFailed && <p role="alert">{t('offline.cleanupFailed')}</p>}
        <SignIn
          onSignedIn={(signedIn) => {
            setCleanupFailed(false);
            setUser(signedIn);
            announceSession({ type: 'signed-in', userId: signedIn.id });
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
            .then((result) => {
              setCleanupFailed(result === 'failed');
              setUser(null);
              navigate('/', { replace: true });
            });
        }}
      />
    </OfflineProvider>
  );
}
