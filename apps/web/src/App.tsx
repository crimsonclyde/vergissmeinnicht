import { useEffect, useState, type ReactNode } from 'react';
import { AcceptInvitation } from './AcceptInvitation.tsx';
import { api, type CurrentUser } from './api.ts';
import { AppShell } from './AppShell.tsx';
import { RecoverAccount } from './RecoverAccount.tsx';
import { navigate, parseRoute, usePathname } from './router.tsx';
import { SignIn } from './SignIn.tsx';

/** Pages reachable without signing in (sign-in, invitation and recovery links). */
function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="app-main" style={{ maxWidth: '36rem' }}>
      <h1>Vergissmeinnicht</h1>
      <p className="muted">Repeatable procedures with trustworthy execution history.</p>
      <div className="card">{children}</div>
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
  if (user === undefined) return <p className="app-main">Loading…</p>;
  if (user === null) {
    return (
      <PublicLayout>
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
