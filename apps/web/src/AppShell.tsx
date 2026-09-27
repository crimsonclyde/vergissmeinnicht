import { useCallback, useEffect, useState } from 'react';
import { AccountSecurity } from './AccountSecurity.tsx';
import { AdminPage } from './AdminPage.tsx';
import { AppearanceSettings } from './AppearanceSettings.tsx';
import { api, messageFor, type CurrentUser, type WorkspaceSummary } from './api.ts';
import { ChangePassword } from './ChangePassword.tsx';
import { t } from './i18n/index.ts';
import { KnotOpener, KnotsPage } from './Knots.tsx';
import { MembersPage, roleLabel } from './MembersPage.tsx';
import { Procedures } from './Procedures.tsx';
import { Link, navigate, paths, type Route } from './router.tsx';
import { Runs } from './Runs.tsx';
import { UserMenu } from './UserMenu.tsx';
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
        <Link href="/" className="brand" aria-label={t('shell.home')}>
          <span className="brand-long">VergissMeinNicht</span>
          <span className="brand-short" aria-hidden="true">
            VMN
          </span>
        </Link>
        {workspaces !== null && workspaces.length > 0 && (
          <label className="workspace-select">
            <select
              aria-label={t('shell.workspace')}
              value={workspaceId ?? ''}
              onChange={(e) => navigate(paths.runs(e.target.value))}
            >
              {workspaceId === null && <option value="">{t('shell.choose')}</option>}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {t('workspace.option', { name: workspace.name, role: roleLabel(workspace.role) })}
                </option>
              ))}
            </select>
          </label>
        )}
        <UserMenu user={props.user} onSignOut={props.onSignOut} />
      </div>
      {workspaceId !== null && (
        <div className="app-header-inner" style={{ paddingTop: 0 }}>
          <nav aria-label={t('shell.sections')} className="nav section-nav">
            <NavLink href={paths.runs(workspaceId)} current={route.page === 'runs'}>
              {t('shell.runs')}
            </NavLink>
            <NavLink href={paths.procedures(workspaceId)} current={route.page === 'procedures'}>
              {t('shell.procedures')}
            </NavLink>
            <NavLink href={paths.members(workspaceId)} current={route.page === 'members'}>
              {t('shell.members')}
            </NavLink>
            {props.capabilities?.includes('knot.manage') === true && (
              <NavLink href={paths.knots(workspaceId)} current={route.page === 'knots'}>
                {t('shell.knots')}
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
  if (context === null || context.workspace.id !== route.workspaceId) return <p>{t('common.loading')}</p>;
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
        <p role="alert">{t('knot.manageOnly')}</p>
      );
  }
}

function NoWorkspace({ user }: { user: CurrentUser }) {
  return (
    <div className="card stack" style={{ marginTop: '2rem' }}>
      <h2 style={{ marginTop: 0 }}>{t('welcome.heading', { name: user.displayName })}</h2>
      <p>{t('welcome.noWorkspace')}</p>
      {user.serverAdmin ? (
        <>
          <p>{t('welcome.adminHint')}</p>
          <p>
            <Link href="/admin">{t('welcome.adminLink')}</Link>
          </p>
        </>
      ) : (
        <p className="muted">{t('welcome.askAdmin')}</p>
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
          <h2>{t('account.heading')}</h2>
          <span className="muted">{t('account.identity', { name: user.displayName, email: user.email })}</span>
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
    content = user.serverAdmin ? <AdminPage onWorkspacesChanged={refresh} /> : <p role="alert">{t('admin.onlyServerAdmins')}</p>;
  } else if (route.page === 'knot') {
    content = <KnotOpener token={route.token} />;
  } else if (route.page === 'runs' || route.page === 'procedures' || route.page === 'members' || route.page === 'knots') {
    content = <WorkspacePage route={route} user={user} onWorkspacesChanged={refresh} onCapabilities={reportCapabilities} />;
  } else if (route.page === 'home') {
    const loading = <p>{t('common.loading')}</p>;
    content = workspaces === null ? loading : workspaces.length === 0 ? <NoWorkspace user={user} /> : loading;
  } else {
    content = (
      <p role="alert">
        {t('shell.notFound')} <Link href="/">{t('common.startPage')}</Link>.
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
