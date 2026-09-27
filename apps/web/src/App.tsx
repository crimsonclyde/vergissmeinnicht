import { useEffect, useState, type ReactNode } from 'react';
import { AcceptInvitation } from './AcceptInvitation.tsx';
import { api, type CurrentUser } from './api.ts';
import { AppShell } from './AppShell.tsx';
import { RecoverAccount } from './RecoverAccount.tsx';
import { navigate, parseRoute, usePathname } from './router.tsx';
import { SignIn } from './SignIn.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import { t } from './i18n/index.ts';

/** Pages reachable without signing in (sign-in, invitation and recovery links). */
function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="app-main" style={{ maxWidth: '36rem' }}>
      <h1>Vergissmeinnicht</h1>
      <p className="muted">{t('public.tagline')}</p>
      <div className="card">{children}</div>
      <SourceFooter />
    </main>
  );
}

export function App() {
  const route = parseRoute(usePathname());
  const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api.currentUser().then(
      (current) => active && setUser(current),
      () => active && setUser(null),
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
        <SignIn onSignedIn={setUser} />
      </PublicLayout>
    );
  }
  return (
    <AppShell
      user={user}
      route={route}
      onSignOut={() => {
        void api.signOut().then(() => {
          setUser(null);
          navigate('/', { replace: true });
        });
      }}
    />
  );
}
