import { useEffect, useState } from 'react';
import { AcceptInvitation } from './AcceptInvitation.tsx';
import { AccountSecurity } from './AccountSecurity.tsx';
import { ChangePassword } from './ChangePassword.tsx';
import { RecoverAccount } from './RecoverAccount.tsx';
import { api, type CurrentUser } from './api.ts';
import { SignIn } from './SignIn.tsx';
import { Workspaces } from './Workspaces.tsx';

const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]+)$/;
const RECOVER_PATH = /^\/recover\/([A-Za-z0-9_-]+)$/;

function Home() {
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

  async function signOut() {
    await api.signOut();
    setUser(null);
  }

  if (user === undefined) return <p>Loading…</p>;
  if (user === null) return <SignIn onSignedIn={setUser} />;
  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading">Welcome, {user.displayName}</h2>
      <p>Signed in as {user.email}.</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <Workspaces user={user} />
      <ChangePassword />
      <AccountSecurity />
    </section>
  );
}

export function App() {
  const invite = INVITE_PATH.exec(window.location.pathname)?.[1];
  const recover = RECOVER_PATH.exec(window.location.pathname)?.[1];
  return (
    <main>
      <h1>Vergissmeinnicht</h1>
      <p>Repeatable procedures with trustworthy execution history.</p>
      {invite !== undefined ? (
        <AcceptInvitation token={invite} />
      ) : recover !== undefined ? (
        <RecoverAccount token={recover} />
      ) : (
        <Home />
      )}
    </main>
  );
}
