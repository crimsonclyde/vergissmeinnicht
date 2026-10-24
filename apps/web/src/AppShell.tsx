import { JournalPage } from './modules/journal/JournalPage.tsx';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccountSecurity } from './AccountSecurity.tsx';
import { AdminPage } from './AdminPage.tsx';
import { AppearanceSettings } from './AppearanceSettings.tsx';
import { CriticalConfirmSettings } from './CriticalConfirmSettings.tsx';
import { Documents } from './Documents.tsx';
import { PhotosPage } from './PhotoGallery.tsx';
import { PreferencesProvider, usePreferences } from './preferences.tsx';
import { OfflineBanner, useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { api, isNetworkError, messageFor, type CurrentUser, type WorkspaceSummary } from './api.ts';
import { DocumentsToolContext } from './documents-tool.ts';
import { Contacts } from './Contacts.tsx';
import { Equipment } from './Equipment.tsx';
import { Maintenance } from './Maintenance.tsx';
import { ContactsToolContext } from './contacts-tool.ts';
import { Calendar } from './Calendar.tsx';
import { ChangePassword } from './ChangePassword.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { t, type MessageKey } from './i18n/index.ts';
import { KnotOpener, KnotsPage } from './Knots.tsx';
import { Lists } from './Lists.tsx';
import { MembersPage, WorkspaceGeneral, WorkspaceStoragePage, roleLabel, workspaceSettingsSections, type WorkspaceSettingsPage } from './MembersPage.tsx';
import { PluginsPage } from './PluginsPage.tsx';
import { MorePage } from './MorePage.tsx';
import { ProcedureBuilder } from './ProcedureBuilder.tsx';
import { Procedures } from './Procedures.tsx';
import { Reminders } from './Reminders.tsx';
import { ProfileIdentity, ProfileSettings } from './ProfileSettings.tsx';
import { ACCOUNT_SECTIONS, Link, navigate, paths, type AccountSection, type Route } from './router.tsx';
import { RingPaint } from './RunGuide.tsx';
import { Runs } from './Runs.tsx';
import { SettingsLayout } from './SettingsLayout.tsx';
import { PlaceScene } from './places/PlaceScene.tsx';
import { PlacesSettings } from './places/PlacesSettings.tsx';
import { placeOfWorkspace } from './places/registry.ts';
import { SettingsMenu } from './SettingsMenu.tsx';
import { SourceFooter } from './SourceFooter.tsx';
import { CoreToolsContext } from './core-tools.ts';
import { TodaySettings } from './TodaySettings.tsx';
import { WorkspaceBackupPage } from './WorkspaceBackupPage.tsx';
import { WeatherSettings } from './WeatherSettings.tsx';
import { ScheduleHistory } from './ScheduleHistory.tsx';
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
  const procedures: Destination = { href: paths.procedures(workspaceId), label: t('shell.procedures'), icon: 'procedures', pages: ['procedures', 'procedure-edit', 'photos'] };
  const reminders: Destination = { href: paths.reminders(workspaceId), label: t('shell.reminders'), icon: 'reminders', pages: ['reminders'] };
  const lists: Destination = { href: paths.lists(workspaceId), label: t('shell.lists'), icon: 'lists', pages: ['lists'] };
  const calendar: Destination = { href: paths.calendar(workspaceId), label: t('shell.calendar'), icon: 'calendar', pages: ['calendar'] };
  // Optional tools (16.2) follow the fixed ones in the sidebar; on phones they are reached through More —
  // the bottom bar keeps exactly four destinations.
  const documents: Destination = { href: paths.documents(workspaceId), label: t('shell.documents'), icon: 'documents', pages: ['documents'] };
  const contacts: Destination = { href: paths.contacts(workspaceId), label: t('shell.contacts'), icon: 'contacts', pages: ['contacts'] };
  const maintenance: Destination = { href: paths.maintenance(workspaceId), label: t('shell.maintenance'), icon: 'maintenance', pages: ['maintenance'] };
  const equipment:Destination={href:paths.equipment(workspaceId),label:t('shell.equipment'),icon:'equipment',pages:['equipment']};
  const journal: Destination = { href: paths.journal(workspaceId), label: t('journal.heading'), icon: 'documents', pages: ['journal'] };
  const optional = [...(tools.includes('JOURNAL') ? [journal] : []),...(tools.includes('DOCUMENTS') ? [documents] : []), ...(tools.includes('CONTACTS') ? [contacts] : []), ...(tools.includes('MAINTENANCE') ? [maintenance] : []),...(tools.includes('EQUIPMENT') ? [equipment]:[])];
  const more: Destination = { href: paths.more(workspaceId), label: t('shell.more'), icon: 'more', pages: ['more', 'reminders', 'calendar', 'history', ...optional.flatMap((tool) => tool.pages)] };
  return { side: [today, ...(tools.includes('PROCEDURES') ? [procedures] : []), ...(tools.includes('REMINDERS') ? [reminders] : []), ...(tools.includes('LISTS') ? [lists] : []), ...(tools.includes('CALENDAR') ? [calendar] : []), ...optional], bar: [today, ...(tools.includes('PROCEDURES') ? [procedures] : []), ...(tools.includes('LISTS') ? [lists] : []), more] };
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

  const { userId, syncLists } = useOffline();
  const load = useCallback(() => {
    api.workspace(route.workspaceId).then(
      (result) => {
        setContext({ workspace: result.workspace, capabilities: result.capabilities, tools: result.tools, toolsRevision: result.toolsRevision });
        setMessage(null);
        rememberWorkspace(result.workspace.id);
        void offlineStore.saveWorkspace(userId, { workspace: { ...result.workspace, tools: result.tools }, capabilities: result.capabilities });
        // Opened online: every List of this Workspace is kept on this device for the shop (17.5) — or forgotten when Lists are off.
        if (result.tools.includes('LISTS')) void syncLists(result.workspace.id);
        else void offlineStore.deleteLists(userId, result.workspace.id);
      },
      async (caught: unknown) => {
        // Offline: the Workspace as last seen on this device (UI only; the server decides on every change).
        const saved = isNetworkError(caught) ? await offlineStore.loadWorkspace(userId, route.workspaceId) : undefined;
        if (saved !== undefined) {
          // Stored flags guide navigation only; online requests always recheck current server settings.
          setContext({ workspace: saved.workspace, capabilities: saved.capabilities, tools: saved.workspace.tools ?? [], toolsRevision: 0 });
          setMessage(null);
          return;
        }
        setContext(null);
        setMessage(messageFor(caught));
      },
    );
  }, [route.workspaceId, userId, syncLists]);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [load]);

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
  const canAdd = { procedure: context.tools.includes('PROCEDURES') && can('procedure.edit'), reminder: context.tools.includes('REMINDERS') && can('schedule.manage'), list: context.tools.includes('LISTS') && can('list.edit'), document: documentsOn && can('document.manage') };
  const settings = (current: WorkspaceSettingsPage, content: ReactNode) => (
    <SettingsLayout
      title={t('menu.workspaceSettings')}
      subtitle={context.workspace.name}
      identity={
        <div className="settings-identity">
          <span className="settings-identity-icon" aria-hidden="true">
            <UiIcon name="settings" />
          </span>
          <div>
            <h2>{t('menu.workspaceSettings')}</h2>
            <span className="muted">{t('workspaceSettings.subtitle', { name: context.workspace.name, role: roleLabel(context.workspace.role) })}</span>
          </div>
        </div>
      }
      navLabel={t('menu.workspaceSettings')}
      sections={workspaceSettingsSections(route.workspaceId, context.tools.includes('PROCEDURES') ? context.capabilities : context.capabilities.filter((capability) => capability !== 'knot.manage'), current)}
    >
      {content}
    </SettingsLayout>
  );

  const openRun = (runId: string) => navigate(paths.run(route.workspaceId, runId));
  const page = (): ReactNode => {
    const required = ({ procedures: 'PROCEDURES', 'procedure-edit': 'PROCEDURES', photos: 'PROCEDURES', run: 'PROCEDURES', history: 'PROCEDURES', knots: 'PROCEDURES', reminders: 'REMINDERS', lists: 'LISTS', calendar: 'CALENDAR' } as Record<string, string>)[route.page];
    if (required !== undefined && !context.tools.includes(required) && !(route.page === 'run' && !navigator.onLine)) return <p role="alert">{t('error.tool_not_enabled')}</p>;
    switch (route.page) {
    case 'workspace':
      return (
        <Today
          workspaceId={route.workspaceId}
          userId={props.user.id}
          userName={props.user.displayName}
          canStart={can('run.start')}
          canSchedule={can('schedule.manage')}
          canExecute={can('run.execute')}
          canAdd={canAdd}
          tools={context.tools}
          canChooseTools={can('workspace.tools.manage')}
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
    case 'schedule-history':
      return <ScheduleHistory key={route.scheduleId} workspaceId={route.workspaceId} scheduleId={route.scheduleId} />;
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
    case 'journal':
      return context.tools.includes('JOURNAL') ? <JournalPage key={route.workspaceId} workspaceId={route.workspaceId} canWrite={can('journal.manage')} /> : <p role="alert">{t('shell.notFound')}</p>;
    case 'equipment':
      return context.tools.includes('EQUIPMENT') ? <Equipment key={`${route.view}:${route.recordId ?? ''}`} workspaceId={route.workspaceId} route={route} canManage={can('equipment.manage')} canPurge={can('equipment.purge')} canSchedule={can('schedule.manage')} tools={context.tools} /> : <p role="alert">{t('shell.notFound')}</p>;
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
          sectionId={route.page === 'run' ? route.sectionId : null}
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
    case 'photos':
      return can('procedure.edit') ? <PhotosPage workspaceId={route.workspaceId} /> : <p role="alert">{t('builder.editOnly')}</p>;
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
    case 'plugins':
      return settings('plugins', can('workspace.tools.manage') ? <PluginsPage context={context} onChanged={reload} /> : <p role="alert">{t('plugins.adminOnly')}</p>);
    case 'storage':
      return settings('storage', can('workspace.settings.manage') ? <WorkspaceStoragePage context={context} /> : <p role="alert">{t('workspaceSettings.storageAdminOnly')}</p>);
    case 'knots':
      return settings('knots', can('knot.manage') ? <KnotsPage workspaceId={route.workspaceId} /> : <p role="alert">{t('knot.manageOnly')}</p>);
    case 'backup':
      return settings('backup', can('workspace.backup') ? <WorkspaceBackupPage workspaceId={route.workspaceId} /> : <p role="alert">{t('backup.adminOnly')}</p>);
    }
  };
  // Pages of other tools show linked Documents only where the Documents tool is on (16.5).
  return (
    <CoreToolsContext.Provider value={context.tools}><DocumentsToolContext.Provider value={{ enabled: documentsOn, canManage: documentsOn && can('document.manage'), canRemoveKept: documentsOn && can('run.document.remove') }}>
      <ContactsToolContext.Provider value={{ enabled: contactsOn, canManage: contactsOn && can('contact.manage') }}>{page()}</ContactsToolContext.Provider>
    </DocumentsToolContext.Provider></CoreToolsContext.Provider>
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

/** Icons and groups of the Profile & settings sections (section 29). */
const ACCOUNT_SECTION_ICONS: Record<AccountSection, UiIconName> = {
  profile: 'profile',
  security: 'security',
  appearance: 'appearance',
  places: 'places',
  today: 'layout',
  confirmations: 'confirmations',
  notifications: 'reminders',
  weather: 'weatherPartlyCloudy',
  journal: 'journal',
};
const ACCOUNT_SECTION_GROUPS: Record<AccountSection, MessageKey> = {
  profile: 'settings.group.you',
  security: 'settings.group.you',
  appearance: 'settings.group.look',
  places: 'settings.group.look',
  today: 'settings.group.look',
  confirmations: 'settings.group.look',
  notifications: 'settings.group.informed',
  weather: 'settings.group.informed',
  journal: 'settings.group.journal',
};

/** Profile & settings (15.1, regrouped in section 29): profile, security, look & feel, notifications, journal. */
function AccountPage({ user, section, tools, workspaces, activeWorkspace, avatar, onAvatarChanged }: { user: CurrentUser; section: Extract<Route, { page: 'account' }>['section']; tools: readonly string[] | null; workspaces: readonly WorkspaceSummary[] | null; activeWorkspace: WorkspaceSummary | null; avatar: string | null; onAvatarChanged: (version: string | null) => void }) {
  // Places (section 30): the tab is there only while the Workspace in use shows a Places theme.
  const { preferences, workspacePreferences } = usePreferences();
  const place = placeOfWorkspace(preferences.theme, workspacePreferences.themes, activeWorkspace?.id ?? null);
  // Weather (19.4) is offered only while the server allows it (W1); unknown until asked.
  const [weatherOn, setWeatherOn] = useState<boolean | null>(null);
  useEffect(() => {
    api.myWeather().then(
      () => setWeatherOn(true),
      () => setWeatherOn(false),
    );
  }, []);
  return (
    <SettingsLayout
      title={t('account.heading')}
      // The Profile section shows the picture large; elsewhere it sits next to the title.
      subtitle={t('account.identity', { name: user.displayName, email: user.email })}
      identity={section === 'profile' ? undefined : <ProfileIdentity user={user} avatar={avatar} />}
      navLabel={t('account.heading')}
      sections={ACCOUNT_SECTIONS.filter((value) => (value !== 'weather' || weatherOn === true || section === 'weather') && (value !== 'places' || place !== null || section === 'places')).map((value) => ({
        href: paths.account(value),
        label: t(`account.section.${value}`),
        current: value === section,
        icon: ACCOUNT_SECTION_ICONS[value],
        group: t(ACCOUNT_SECTION_GROUPS[value]),
      }))}
    >
      {section === 'profile' && <ProfileSettings user={user} avatar={avatar} onAvatarChanged={onAvatarChanged} workspaces={workspaces} />}
      {section === 'journal' && <JournalPage key={user.id} canWrite={true} />}
      {section === 'notifications' && (
        <div className="card">
          <NotificationSettings serverAdmin={user.serverAdmin} />
        </div>
      )}
      {section === 'places' && <PlacesSettings userId={user.id} workspace={place === null ? null : activeWorkspace} config={place} />}
      {section === 'today' && (
        <div className="card">
          <TodaySettings userId={user.id} tools={tools} weatherOn={weatherOn === true} />
        </div>
      )}
      {section === 'weather' && (
        <div className="card">
          <WeatherSettings />
        </div>
      )}
      {section === 'appearance' && (
        <div className="card">
          <AppearanceSettings workspaces={workspaces} />
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

/**
 * The start page opens the person's default Workspace (section 28), else the last used, else the first.
 * Waits for the account's choice (or its failure, offline) so it never jumps twice.
 */
function OpenFirstWorkspace({ workspaces }: { workspaces: readonly WorkspaceSummary[] }) {
  const { workspacePreferences, workspacePreferencesSettled } = usePreferences();
  useEffect(() => {
    if (!workspacePreferencesSettled) return;
    const last = rememberedWorkspace();
    const target =
      workspaces.find((workspace) => workspace.id === workspacePreferences.defaultWorkspaceId) ?? workspaces.find((workspace) => workspace.id === last) ?? workspaces[0];
    if (target !== undefined) navigate(paths.home(target.id), { replace: true });
  }, [workspaces, workspacePreferences.defaultWorkspaceId, workspacePreferencesSettled]);
  return <p>{t('common.loading')}</p>;
}

/** How wide the page may get: forms and lists stay readable, the builder uses the screen. */
function widthOf(route: Route): 'narrow' | 'wide' | undefined {
  if (route.page === 'procedure-edit') return 'wide';
  // Today sets its own width: two columns of cards on a wide screen, a reading width with one (19.1).
  if (route.page === 'lists' || route.page === 'more' || route.page === 'reminders') return 'narrow';
  if (route.page === 'documents' && route.view === 'new') return 'narrow';
  return undefined;
}

export function AppShell(props: { user: CurrentUser; route: Route; onSignOut: () => void }) {
  const { user, route } = props;
  const { queued, listChanges } = useOffline();
  // Unsent offline changes are deleted with the rest of the device data on sign-out: ask first.
  const signOut = () => {
    const unsent = queued.length + listChanges.length;
    if (unsent > 0 && !window.confirm(t('offline.signOutConfirm', { count: unsent }))) return;
    props.onSignOut();
  };
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The person's picture version (section 29); changed on the Profile page, shown in the Settings button.
  const [avatar, setAvatar] = useState<string | null>(user.avatar ?? null);

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

  const workspaceId = 'workspaceId' in route ? route.workspaceId : null;
  // On pages without a Workspace (settings, admin) the tools stay reachable: they lead to the last used one.
  const remembered = workspaceId === null ? rememberedWorkspace() : null;
  const navWorkspaceId = workspaceId ?? workspaces?.find((workspace) => workspace.id === remembered)?.id ?? null;
  const nav = navWorkspaceId === null ? null : destinations(navWorkspaceId, workspaces?.find((workspace) => workspace.id === navWorkspaceId)?.tools ?? []);
  // Focused work hides the global navigation: the builder everywhere, an execution on phones.
  const focus = route.page === 'procedure-edit' ? 'edit' : route.page === 'run' ? 'run' : undefined;

  let content;
  if (route.page === 'account') {
    // Today cards of tools that are off where the person last was are marked as such (UI only).
    content = (
      <AccountPage
        user={user}
        section={route.section}
        tools={workspaces?.find((workspace) => workspace.id === rememberedWorkspace())?.tools ?? null}
        workspaces={workspaces}
        activeWorkspace={workspaces?.find((workspace) => workspace.id === navWorkspaceId) ?? null}
        avatar={avatar}
        onAvatarChanged={setAvatar}
      />
    );
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
    content = workspaces === null ? loading : workspaces.length === 0 ? <NoWorkspace user={user} /> : <OpenFirstWorkspace workspaces={workspaces} />;
  } else {
    content = (
      <p role="alert">
        {t('shell.notFound')} <Link href="/">{t('common.startPage')}</Link>.
      </p>
    );
  }

  return (
    // Appearance shows the default theme, so choosing it there is seen at once; elsewhere the theme
    // the person chose for the Workspace shown (or last used) applies (section 28).
    <PreferencesProvider workspaceId={route.page === 'account' && route.section === 'appearance' ? null : navWorkspaceId}>
      <RingPaint />
      {/* Places (section 30): the person's own look of the Workspace shown; strongest on Today. */}
      <PlaceScene userId={user.id} workspaceId={navWorkspaceId} prominence={route.page === 'workspace' ? 'today' : 'page'} />
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
          <SettingsMenu user={user} avatar={avatar} workspaceId={navWorkspaceId} currentPath={window.location.pathname} onSignOut={signOut} />
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
