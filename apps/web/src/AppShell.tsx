import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccountSecurity } from './AccountSecurity.tsx';
import { AdminPage } from './AdminPage.tsx';
import { AppearanceSettings } from './AppearanceSettings.tsx';
import { CriticalConfirmSettings } from './CriticalConfirmSettings.tsx';
import { Documents } from './Documents.tsx';
import { PreferencesProvider } from './preferences.tsx';
import { OfflineBanner, useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { api, isNetworkError, messageFor, type CurrentUser, type WorkspaceSummary } from './api.ts';
import { DocumentsToolContext } from './documents-tool.ts';
import { Contacts } from './Contacts.tsx';
import { Maintenance } from './Maintenance.tsx';
import { ContactsToolContext } from './contacts-tool.ts';
import { Calendar } from './Calendar.tsx';
import { ChangePassword } from './ChangePassword.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { t } from './i18n/index.ts';
import { KnotOpener, KnotsPage } from './Knots.tsx';
import { Lists } from './Lists.tsx';
import { MembersPage, WorkspaceGeneral, roleLabel, workspaceSettingsSections } from './MembersPage.tsx';
import { MorePage } from './MorePage.tsx';
import { ProcedureBuilder } from './ProcedureBuilder.tsx';
import { Procedures } from './Procedures.tsx';
import { Reminders } from './Reminders.tsx';
import { ACCOUNT_SECTIONS, Link, navigate, paths, type Route } from './router.tsx';
import { Runs } from './Runs.tsx';
import { SettingsLayout } from './SettingsLayout.tsx';
import { SettingsMenu } from './SettingsMenu.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import { Today } from './Today.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
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
type Page = Route['page'];

interface Destination {
  readonly href: string;
  readonly label: string;
  readonly icon: UiIconName;
  /** Pages on which this destination is the current one. */
  readonly pages: readonly Page[];
}

/**
 * The tools (15.1). Desktop sidebar: Today, Procedures, Reminders, Lists, Calendar. Phone bottom bar:
 * Today, Procedures, Lists and More — More leads to Reminders, Calendar and the completed history.
 * `tools`: the optional tools the Workspace has switched on (UI only; every request is checked).
 */
export function destinations(workspaceId: string, tools: readonly string[] = []): { side: Destination[]; bar: Destination[] } {
  const today: Destination = { href: paths.home(workspaceId), label: t('shell.today'), icon: 'today', pages: ['workspace'] };
  const procedures: Destination = { href: paths.procedures(workspaceId), label: t('shell.procedures'), icon: 'procedures', pages: ['procedures', 'procedure-edit'] };
  const reminders: Destination = { href: paths.reminders(workspaceId), label: t('shell.reminders'), icon: 'reminders', pages: ['reminders'] };
  const lists: Destination = { href: paths.lists(workspaceId), label: t('shell.lists'), icon: 'lists', pages: ['lists'] };
  const calendar: Destination = { href: paths.calendar(workspaceId), label: t('shell.calendar'), icon: 'calendar', pages: ['calendar'] };
  // Optional tools (16.2) follow the fixed ones in the sidebar; on phones they are reached through More —
  // the bottom bar keeps exactly four destinations.
  const documents: Destination = { href: paths.documents(workspaceId), label: t('shell.documents'), icon: 'documents', pages: ['documents'] };
  const contacts: Destination = { href: paths.contacts(workspaceId), label: t('shell.contacts'), icon: 'contacts', pages: ['contacts'] };
  const maintenance: Destination = { href: paths.maintenance(workspaceId), label: t('shell.maintenance'), icon: 'maintenance', pages: ['maintenance'] };
  const optional = [...(tools.includes('DOCUMENTS') ? [documents] : []), ...(tools.includes('CONTACTS') ? [contacts] : []), ...(tools.includes('MAINTENANCE') ? [maintenance] : [])];
  const more: Destination = { href: paths.more(workspaceId), label: t('shell.more'), icon: 'more', pages: ['more', 'reminders', 'calendar', 'history', ...optional.flatMap((tool) => tool.pages)] };
  return { side: [today, procedures, reminders, lists, calendar, ...optional], bar: [today, procedures, lists, more] };
}

function NavLinks({ items, page }: { items: readonly Destination[]; page: Page }) {
  return (
    <>
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined}>
          <UiIcon name={item.icon} size="1.4em" />
          <span>{item.label}</span>
        </Link>
      ))}
    </>
  );
}

/** Loads the Workspace (name, role, capabilities) for the Workspace pages. */
function WorkspacePage(props: {
  route: WorkspaceRoute;
  user: CurrentUser;
  onWorkspacesChanged: () => void;
}) {
  const { route } = props;
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { userId } = useOffline();
  const load = useCallback(() => {
    api.workspace(route.workspaceId).then(
      (result) => {
        setContext({ workspace: result.workspace, capabilities: result.capabilities, tools: result.tools });
        setMessage(null);
        rememberWorkspace(result.workspace.id);
        void offlineStore.saveWorkspace(userId, { workspace: result.workspace, capabilities: result.capabilities });
      },
      async (caught: unknown) => {
        // Offline: the Workspace as last seen on this device (UI only; the server decides on every change).
        const saved = isNetworkError(caught) ? await offlineStore.loadWorkspace(userId, route.workspaceId) : undefined;
        if (saved !== undefined) {
          // Optional tools do not work offline: none are offered from the saved copy.
          setContext({ workspace: saved.workspace, capabilities: saved.capabilities, tools: [] });
          setMessage(null);
          return;
        }
        setContext(null);
        setMessage(messageFor(caught));
      },
    );
  }, [route.workspaceId, userId]);
  useEffect(load, [load]);

  if (message !== null) return <p role="alert">{message}</p>;
  if (context === null || context.workspace.id !== route.workspaceId) return <p>{t('common.loading')}</p>;
  const can = (capability: string) => context.capabilities.includes(capability);
  const reload = () => {
    load();
    props.onWorkspacesChanged();
  };
  /** What the person may create here (UI only): drives the Add chooser. */
  const documentsOn = context.tools.includes('DOCUMENTS');
  const contactsOn = context.tools.includes('CONTACTS');
  const canAdd = { procedure: can('procedure.edit'), reminder: can('schedule.manage'), list: can('list.edit'), document: documentsOn && can('document.manage') };
  const settings = (current: 'settings' | 'members' | 'knots', content: ReactNode) => (
    <SettingsLayout
      title={t('menu.workspaceSettings')}
      subtitle={context.workspace.name}
      navLabel={t('menu.workspaceSettings')}
      sections={workspaceSettingsSections(route.workspaceId, context.capabilities, current)}
    >
      {content}
    </SettingsLayout>
  );

  const openRun = (runId: string) => navigate(paths.run(route.workspaceId, runId));
  const page = (): ReactNode => {
    switch (route.page) {
    case 'workspace':
      return (
        <Today
          workspaceId={route.workspaceId}
          userId={props.user.id}
          canStart={can('run.start')}
          canSchedule={can('schedule.manage')}
          canExecute={can('run.execute')}
          canAdd={canAdd}
          onOpenRun={openRun}
        />
      );
    case 'reminders':
      return (
        <Reminders
          workspaceId={route.workspaceId}
          userId={props.user.id}
          creating={route.creating}
          canStart={can('run.start')}
          canSchedule={can('schedule.manage')}
          canExecute={can('run.execute')}
          onOpenRun={openRun}
        />
      );
    case 'lists':
      return <Lists key={route.listId ?? 'overview'} workspaceId={route.workspaceId} listId={route.listId} creating={route.creating} canEdit={can('list.edit')} />;
    case 'calendar':
      return (
        <Calendar
          workspaceId={route.workspaceId}
          userId={props.user.id}
          canStart={can('run.start')}
          canSchedule={can('schedule.manage')}
          canExecute={can('run.execute')}
          onOpenRun={openRun}
        />
      );
    case 'more':
      return <MorePage workspaceId={route.workspaceId} tools={context.tools} />;
    case 'documents':
      // Not switched on here: the tool does not exist for this Workspace (the server answers 404 as well).
      return documentsOn ? (
        <Documents key={`${route.view}:${route.folderId ?? ''}:${route.documentId ?? ''}`} workspaceId={route.workspaceId} route={route} canManage={can('document.manage')} canPurge={can('document.purge')} canSchedule={can('schedule.manage')} />
      ) : (
        <p role="alert">
          {t('shell.notFound')} <Link href={paths.home(route.workspaceId)}>{t('common.startPage')}</Link>.
        </p>
      );
    case 'contacts':
      // Not switched on here: the tool does not exist for this Workspace (the server answers 404 as well).
      return contactsOn ? (
        <Contacts key={`${route.view}:${route.contactId ?? ''}`} workspaceId={route.workspaceId} route={route} canManage={can('contact.manage')} canExport={can('contact.export')} canPurge={can('contact.purge')} />
      ) : (
        <p role="alert">
          {t('shell.notFound')} <Link href={paths.home(route.workspaceId)}>{t('common.startPage')}</Link>.
        </p>
      );
    case 'maintenance':
      // Not switched on here: the tool does not exist for this Workspace (the server answers 404 as well).
      return context.tools.includes('MAINTENANCE') ? (
        <Maintenance key={`${route.view}:${route.recordId ?? ''}`} workspaceId={route.workspaceId} route={route} canManage={can('maintenance.manage')} canPurge={can('maintenance.purge')} canSchedule={can('schedule.manage')} />
      ) : (
        <p role="alert">
          {t('shell.notFound')} <Link href={paths.home(route.workspaceId)}>{t('common.startPage')}</Link>.
        </p>
      );
    case 'history':
    case 'run':
      return (
        <Runs
          workspaceId={route.workspaceId}
          canExecute={can('run.execute')}
          canAbort={can('run.abort')}
          canStart={can('run.start')}
          canManageKnots={can('knot.manage')}
          openRunId={route.page === 'run' ? route.runId : null}
          onOpen={(runId) => navigate(runId === null ? paths.history(route.workspaceId) : paths.run(route.workspaceId, runId))}
          onHome={() => navigate(paths.home(route.workspaceId))}
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
          canSchedule={can('schedule.manage')}
          onOpenRun={openRun}
        />
      );
    case 'procedure-edit':
      return can('procedure.edit') ? (
        <ProcedureBuilder
          key={route.procedureId ?? 'new'}
          workspaceId={route.workspaceId}
          procedureId={route.procedureId}
          canStart={can('run.start')}
          canSchedule={can('schedule.manage')}
          onOpenRun={openRun}
        />
      ) : (
        <p role="alert">
          {t('builder.editOnly')} <Link href={paths.procedures(route.workspaceId)}>{t('builder.backToProcedures')}</Link>
        </p>
      );
    case 'settings':
      return settings('settings', <WorkspaceGeneral key={context.workspace.name} context={context} onWorkspacesChanged={reload} />);
    case 'members':
      return settings('members', <MembersPage context={context} currentUserId={props.user.id} />);
    case 'knots':
      return settings('knots', can('knot.manage') ? <KnotsPage workspaceId={route.workspaceId} /> : <p role="alert">{t('knot.manageOnly')}</p>);
    }
  };
  // Pages of other tools show linked Documents only where the Documents tool is on (16.5).
  return (
    <DocumentsToolContext.Provider value={{ enabled: documentsOn, canManage: documentsOn && can('document.manage'), canRemoveKept: documentsOn && can('run.document.remove') }}>
      <ContactsToolContext.Provider value={{ enabled: contactsOn, canManage: contactsOn && can('contact.manage') }}>{page()}</ContactsToolContext.Provider>
    </DocumentsToolContext.Provider>
  );
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

/** Profile & settings (15.1): personal notifications, appearance, password and security, confirmations. */
function AccountPage({ user, section }: { user: CurrentUser; section: Extract<Route, { page: 'account' }>['section'] }) {
  return (
    <SettingsLayout
      title={t('account.heading')}
      subtitle={t('account.identity', { name: user.displayName, email: user.email })}
      navLabel={t('account.heading')}
      sections={ACCOUNT_SECTIONS.map((value) => ({ href: paths.account(value), label: t(`account.section.${value}`), current: value === section }))}
    >
      {section === 'notifications' && (
        <div className="card">
          <NotificationSettings serverAdmin={user.serverAdmin} />
        </div>
      )}
      {section === 'appearance' && (
        <div className="card">
          <AppearanceSettings />
        </div>
      )}
      {section === 'security' && (
        <>
          <div className="card">
            <ChangePassword />
          </div>
          <div className="card">
            <AccountSecurity />
          </div>
        </>
      )}
      {section === 'confirmations' && (
        <div className="card">
          <CriticalConfirmSettings />
        </div>
      )}
    </SettingsLayout>
  );
}

/** How wide the page may get: forms and lists stay readable, the builder uses the screen. */
function widthOf(route: Route): 'narrow' | 'wide' | undefined {
  if (route.page === 'procedure-edit') return 'wide';
  if (route.page === 'lists' || route.page === 'more' || route.page === 'workspace' || route.page === 'reminders') return 'narrow';
  if (route.page === 'documents' && route.view === 'new') return 'narrow';
  return undefined;
}

export function AppShell(props: { user: CurrentUser; route: Route; onSignOut: () => void }) {
  const { user, route } = props;
  const { queued } = useOffline();
  // Unsent offline changes are deleted with the rest of the device data on sign-out: ask first.
  const signOut = () => {
    if (queued.length > 0 && !window.confirm(t('offline.signOutConfirm', { count: queued.length }))) return;
    props.onSignOut();
  };
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.workspaces().then(
      (list) => {
        setWorkspaces(list);
        void offlineStore.saveWorkspaceList(user.id, list);
      },
      async (caught: unknown) => {
        const saved = isNetworkError(caught) ? await offlineStore.loadWorkspaceList(user.id) : undefined;
        if (saved !== undefined) setWorkspaces(saved);
        else setMessage(messageFor(caught));
      },
    );
  }, [user.id]);
  useEffect(refresh, [refresh]);

  // The start page opens the last used (or first) Workspace.
  useEffect(() => {
    if (route.page !== 'home' || workspaces === null || workspaces.length === 0) return;
    const last = rememberedWorkspace();
    const target = workspaces.find((workspace) => workspace.id === last) ?? workspaces[0];
    if (target !== undefined) navigate(paths.home(target.id), { replace: true });
  }, [route.page, workspaces]);

  const workspaceId = 'workspaceId' in route ? route.workspaceId : null;
  // On pages without a Workspace (settings, admin) the tools stay reachable: they lead to the last used one.
  const remembered = workspaceId === null ? rememberedWorkspace() : null;
  const navWorkspaceId = workspaceId ?? workspaces?.find((workspace) => workspace.id === remembered)?.id ?? null;
  const nav = navWorkspaceId === null ? null : destinations(navWorkspaceId, workspaces?.find((workspace) => workspace.id === navWorkspaceId)?.tools ?? []);
  // Focused work hides the global navigation: the builder everywhere, an execution on phones.
  const focus = route.page === 'procedure-edit' ? 'edit' : route.page === 'run' ? 'run' : undefined;

  let content;
  if (route.page === 'account') {
    content = <AccountPage user={user} section={route.section} />;
  } else if (route.page === 'admin') {
    content = user.serverAdmin ? (
      <AdminPage section={route.section} currentUserId={user.id} onWorkspacesChanged={refresh} />
    ) : (
      <p role="alert">{t('admin.onlyServerAdmins')}</p>
    );
  } else if (route.page === 'knot') {
    content = <KnotOpener token={route.token} />;
  } else if ('workspaceId' in route) {
    content = <WorkspacePage route={route} user={user} onWorkspacesChanged={refresh} />;
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
    <PreferencesProvider>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('shell.skipToContent')}
      </a>
      <div className="shell" data-focus={focus}>
        <header className="shell-side">
          {/* The product name is the page's level-one heading; each page's own title is a level-two heading. */}
          <h1 className="brand-heading">
            <Link href="/" className="brand" aria-label={t('shell.home')}>
              <img className="brand-icon" src="/icon.svg" alt="" width={36} height={36} />
              <span className="brand-long">
                VergissMein<span className="brand-accent">Nicht</span>
              </span>
            </Link>
          </h1>
          {workspaces !== null && workspaces.length > 0 && (
            <label className="workspace-select">
              <select aria-label={t('shell.workspace')} value={navWorkspaceId ?? ''} onChange={(e) => navigate(paths.home(e.target.value))}>
                {navWorkspaceId === null && <option value="">{t('shell.choose')}</option>}
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {t('workspace.option', { name: workspace.name, role: roleLabel(workspace.role) })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {nav !== null && (
            <nav aria-label={t('shell.tools')} className="side-nav">
              <NavLinks items={nav.side} page={route.page} />
            </nav>
          )}
          <SettingsMenu user={user} workspaceId={navWorkspaceId} currentPath={window.location.pathname} onSignOut={signOut} />
        </header>
        <div className="shell-main">
          <main id="main" tabIndex={-1} className="app-main" data-width={widthOf(route)}>
            <OfflineBanner />
            {message !== null && <p role="alert">{message}</p>}
            {content}
            <SourceFooter />
          </main>
        </div>
        {nav !== null && (
          <nav aria-label={t('shell.tools')} className="tab-bar">
            <NavLinks items={nav.bar} page={route.page} />
          </nav>
        )}
      </div>
    </PreferencesProvider>
  );
}
