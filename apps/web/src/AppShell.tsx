import { useCallback, useEffect, useState } from 'react';
import { AccountSecurity } from './AccountSecurity.tsx';
import { AdminPage } from './AdminPage.tsx';
import { AppearanceSettings } from './AppearanceSettings.tsx';
import { api, messageFor, type CurrentUser, type WorkspaceSummary } from './api.ts';
import { ChangePassword } from './ChangePassword.tsx';
import { KnotOpener, KnotsPage } from './Knots.tsx';
import { MembersPage, ROLE_LABELS } from './MembersPage.tsx';
import { Procedures } from './Procedures.tsx';
import { Link, navigate, paths, type Route } from './router.tsx';
import { Runs } from './Runs.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import type { WorkspaceContext } from './workspace-context.ts';

const LAST_WORKSPACE_KEY = 'vmn.lastWorkspace';

// Per-viewer convenience only; storage may be unavailable (private mode) — never required.
function rememberWorkspace(id: string): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    /* ignore */
  }
}
function rememberedWorkspace(): string | null {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

type WorkspaceRoute = Extract<Route, { workspaceId: string }>;

function NavLink({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

function Header(props: {
  user: CurrentUser;
  route: Route;
  workspaces: WorkspaceSummary[] | null;
  workspaceId: string | null;
  /** Capabilities in the shown Workspace (UI only); `null` while unknown. */
  capabilities: readonly string[] | null;
  onSignOut: () => void;
}) {
  const { route, workspaceId, workspaces } = props;
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand">
          Vergissmeinnicht
        </Link>
        {workspaces !== null && workspaces.length > 0 && (
          <label className="row" style={{ fontWeight: 400 }}>
            <span className="muted">Workspace</span>
            <select
              aria-label="Workspace"
              value={workspaceId ?? ''}
              onChange={(e) => navigate(paths.runs(e.target.value))}
            >
              {workspaceId === null && <option value="">Choose…</option>}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({ROLE_LABELS[workspace.role]})
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="Account" className="nav">
          {props.user.serverAdmin && (
            <NavLink href="/admin" current={route.page === 'admin'}>
              Server admin
            </NavLink>
          )}
          <NavLink href="/account" current={route.page === 'account'}>
            {`Account (${props.user.displayName})`}
          </NavLink>
          <button type="button" className="quiet" onClick={props.onSignOut}>
            Sign out
          </button>
        </nav>
      </div>
      {workspaceId !== null && (
        <div className="app-header-inner" style={{ paddingTop: 0 }}>
          <nav aria-label="Workspace sections" className="nav">
            <NavLink href={paths.runs(workspaceId)} current={route.page === 'runs'}>
              Runs
            </NavLink>
            <NavLink href={paths.procedures(workspaceId)} current={route.page === 'procedures'}>
              Procedures
            </NavLink>
            <NavLink href={paths.members(workspaceId)} current={route.page === 'members'}>
              Members
            </NavLink>
            {props.capabilities?.includes('knot.manage') === true && (
              <NavLink href={paths.knots(workspaceId)} current={route.page === 'knots'}>
                Knot links
              </NavLink>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

/** Loads the Workspace (name, role, capabilities) for the Workspace pages. */
function WorkspacePage(props: {
  route: WorkspaceRoute;
  user: CurrentUser;
  onWorkspacesChanged: () => void;
  onCapabilities: (workspaceId: string, capabilities: readonly string[]) => void;
}) {
  const { onCapabilities } = props;
  const { route } = props;
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api.workspace(route.workspaceId).then(
      (result) => {
        setContext({ workspace: result.workspace, capabilities: result.capabilities });
        setMessage(null);
        rememberWorkspace(result.workspace.id);
        onCapabilities(result.workspace.id, result.capabilities);
      },
      (caught: unknown) => {
        setContext(null);
        setMessage(messageFor(caught));
      },
    );
  }, [route.workspaceId, onCapabilities]);
  useEffect(load, [load]);

  if (message !== null) return <p role="alert">{message}</p>;
  if (context === null || context.workspace.id !== route.workspaceId) return <p>Loading…</p>;
  const can = (capability: string) => context.capabilities.includes(capability);
  const reload = () => {
    load();
    props.onWorkspacesChanged();
  };

  switch (route.page) {
    case 'runs':
      return (
        <Runs
          workspaceId={route.workspaceId}
          canExecute={can('run.execute')}
          canAbort={can('run.abort')}
          canStart={can('run.start')}
          canManageKnots={can('knot.manage')}
          openRunId={route.runId}
          onOpen={(runId) => navigate(runId === null ? paths.runs(route.workspaceId) : paths.run(route.workspaceId, runId))}
        />
      );
    case 'procedures':
      return (
        <Procedures
          key={route.procedureId ?? 'list'}
          workspaceId={route.workspaceId}
          openProcedureId={route.procedureId}
          canManageKnots={can('knot.manage')}
          canEdit={can('procedure.edit')}
          canRestore={can('procedure.restore')}
          canStartRun={can('run.start')}
          onRunStarted={(runId) => navigate(paths.run(route.workspaceId, runId))}
        />
      );
    case 'members':
      return <MembersPage key={context.workspace.name} context={context} currentUserId={props.user.id} onWorkspacesChanged={reload} />;
    case 'knots':
      return can('knot.manage') ? (
        <KnotsPage workspaceId={route.workspaceId} />
      ) : (
        <p role="alert">Only editors and admins of this Workspace manage Knot links.</p>
      );
  }
}

function NoWorkspace({ user }: { user: CurrentUser }) {
  return (
    <div className="card stack" style={{ marginTop: '2rem' }}>
      <h2 style={{ marginTop: 0 }}>Welcome, {user.displayName}</h2>
      <p>You are not a member of any Workspace yet.</p>
      {user.serverAdmin ? (
        <p>
          As a server admin you can <Link href="/admin">create a Workspace</Link> and invite people.
        </p>
      ) : (
        <p className="muted">Ask a Workspace admin to add you.</p>
      )}
    </div>
  );
}

export function AppShell(props: { user: CurrentUser; route: Route; onSignOut: () => void }) {
  const { user, route } = props;
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{ workspaceId: string; list: readonly string[] } | null>(null);
  const reportCapabilities = useCallback(
    (id: string, list: readonly string[]) => setCapabilities({ workspaceId: id, list }),
    [],
  );

  const refresh = useCallback(() => {
    api.workspaces().then(setWorkspaces, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  useEffect(refresh, [refresh]);

  // The start page opens the last used (or first) Workspace.
  useEffect(() => {
    if (route.page !== 'home' || workspaces === null || workspaces.length === 0) return;
    const last = rememberedWorkspace();
    const target = workspaces.find((workspace) => workspace.id === last) ?? workspaces[0];
    if (target !== undefined) navigate(paths.runs(target.id), { replace: true });
  }, [route.page, workspaces]);

  const workspaceId = 'workspaceId' in route ? route.workspaceId : null;

  let content;
  if (route.page === 'account') {
    content = (
      <>
        <div className="page-header">
          <h2>Account</h2>
          <span className="muted">
            {user.displayName} · {user.email}
          </span>
        </div>
        <div className="card">
          <ChangePassword />
        </div>
        <div className="card">
          <AccountSecurity />
        </div>
        <div className="card">
          <AppearanceSettings />
        </div>
      </>
    );
  } else if (route.page === 'admin') {
    content = user.serverAdmin ? <AdminPage onWorkspacesChanged={refresh} /> : <p role="alert">Only server admins can open this page.</p>;
  } else if (route.page === 'knot') {
    content = <KnotOpener token={route.token} />;
  } else if (route.page === 'runs' || route.page === 'procedures' || route.page === 'members' || route.page === 'knots') {
    content = <WorkspacePage route={route} user={user} onWorkspacesChanged={refresh} onCapabilities={reportCapabilities} />;
  } else if (route.page === 'home') {
    content = workspaces === null ? <p>Loading…</p> : workspaces.length === 0 ? <NoWorkspace user={user} /> : <p>Loading…</p>;
  } else {
    content = (
      <p role="alert">
        This page does not exist. <Link href="/">Go to the start page</Link>.
      </p>
    );
  }

  return (
    <>
      <Header
        user={user}
        route={route}
        workspaces={workspaces}
        workspaceId={workspaceId}
        capabilities={capabilities !== null && capabilities.workspaceId === workspaceId ? capabilities.list : null}
        onSignOut={props.onSignOut}
      />
      <main className="app-main">
        {message !== null && <p role="alert">{message}</p>}
        {content}
        <SourceFooter />
      </main>
    </>
  );
}
