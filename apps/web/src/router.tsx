import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Minimal client-side routing on the History API (no dependency). The server serves the SPA for any path. */
const listeners = new Set<() => void>();

/**
 * Asked before the app leaves the current page (15.2): an editor with unsaved changes registers a guard
 * that returns `false` to stay. One guard at a time; `null` removes it.
 */
let guard: (() => boolean) | null = null;
/** The path the app shows; a refused Back/Forward returns to it. */
let shownPath = typeof window === 'undefined' ? '/' : window.location.pathname;

export function setNavigationGuard(next: (() => boolean) | null): void {
  guard = next;
}

const mayLeave = (): boolean => guard === null || guard();

export function navigate(path: string, options: { replace?: boolean; force?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (options.force !== true && !mayLeave()) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  // `path` may end in a fragment (e.g. `#history`); only the path decides which page is shown.
  shownPath = path.split('#')[0] ?? path;
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    const onPop = () => {
      // Back/Forward cannot be cancelled: when the guard says stay, put the left page back.
      if (window.location.pathname !== shownPath && !mayLeave()) {
        window.history.pushState(null, '', shownPath);
        return;
      }
      shownPath = window.location.pathname;
      update();
    };
    listeners.add(update);
    window.addEventListener('popstate', onPop);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return pathname;
}

/** A normal link (works with middle-click, copy link, …) that navigates in-app on plain clicks. */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { onClick, ...rest } = props;
  return (
    <a
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(props.href);
      }}
    />
  );
}

/** Sections of Profile & settings and of Server admin (15.1): one page each, so nothing unrelated has to be scrolled past. */
export const ACCOUNT_SECTIONS = ['notifications', 'today', 'weather', 'appearance', 'security', 'confirmations'] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];
export const ADMIN_SECTIONS = ['workspaces', 'invitations', 'accounts', 'notifications', 'weather', 'server', 'log'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export type Route =
  | { readonly page: 'home' }
  | { readonly page: 'invite'; readonly token: string }
  | { readonly page: 'recover'; readonly token: string }
  | { readonly page: 'knot'; readonly token: string }
  | { readonly page: 'account'; readonly section: AccountSection }
  | { readonly page: 'admin'; readonly section: AdminSection }
  /** Today (15.1; the former Workspace Home): unfinished Runs, what is overdue, what is due today. */
  | { readonly page: 'workspace'; readonly workspaceId: string }
  /** Reminders (15.3): standalone obligations; `creating` opens the New reminder dialog. */
  | { readonly page: 'reminders'; readonly workspaceId: string; readonly creating: boolean }
  /** Lists (15.3): the overview (`listId` null), one List, or the New list dialog (`creating`). */
  | { readonly page: 'lists'; readonly workspaceId: string; readonly listId: string | null; readonly creating: boolean }
  /**
   * Documents (16.2): a Folder (`folderId` null = top level), one Document, the upload flow into a
   * Folder (`view: 'new'`) or Trash.
   */
  | { readonly page: 'documents'; readonly workspaceId: string; readonly view: 'folder' | 'new' | 'document' | 'trash'; readonly folderId: string | null; readonly documentId: string | null }
  /** Contacts (16.6): the list, one Contact, the import of a file, or Trash. */
  | { readonly page: 'contacts'; readonly workspaceId: string; readonly view: 'list' | 'contact' | 'import' | 'trash'; readonly contactId: string | null }
  /** Maintenance (16.7): the board and list, one record, or Trash. */
  | { readonly page: 'equipment'; readonly workspaceId:string; readonly view:'overview'|'record'|'trash'; readonly recordId:string|null }
  | { readonly page: 'maintenance'; readonly workspaceId: string; readonly view: 'overview' | 'record' | 'trash'; readonly recordId: string | null }
  /** Calendar and agenda of Occurrences (14.4). */
  | { readonly page: 'calendar'; readonly workspaceId: string }
  /** Phone: what does not fit the bottom bar — Reminders, Calendar, Completed history. */
  | { readonly page: 'more'; readonly workspaceId: string }
  /** Completed history (13.14): finished executions. */
  | { readonly page: 'schedule-history'; readonly workspaceId: string; readonly scheduleId: string }
  | { readonly page: 'history'; readonly workspaceId: string }
  /** One execution (Run). */
  | { readonly page: 'run'; readonly workspaceId: string; readonly runId: string }
  | { readonly page: 'procedures'; readonly workspaceId: string; readonly procedureId: string | null }
  /** The Procedure builder (15.2): a new Procedure (`procedureId` null) or an existing one. */
  | { readonly page: 'procedure-edit'; readonly workspaceId: string; readonly procedureId: string | null }
  /** Workspace settings (15.1): general, members, sharing links. */
  | { readonly page: 'settings'; readonly workspaceId: string }
  | { readonly page: 'members'; readonly workspaceId: string }
  | { readonly page: 'knots'; readonly workspaceId: string }
  | { readonly page: 'not-found' };

const TOKEN = '([A-Za-z0-9_-]+)';
const ID = '([0-9a-f-]{36})';

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined => values.find((candidate) => candidate === value);

/** Maps a path to a page. Ids are only routing data; the server authorizes every request. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  let match: RegExpExecArray | null;
  if (path === '/') return { page: 'home' };
  if ((match = new RegExp(`^/invite/${TOKEN}$`).exec(path))) return { page: 'invite', token: match[1] ?? '' };
  if ((match = new RegExp(`^/recover/${TOKEN}$`).exec(path))) return { page: 'recover', token: match[1] ?? '' };
  if ((match = new RegExp(`^/knot/${TOKEN}$`).exec(path))) return { page: 'knot', token: match[1] ?? '' };
  if (path === '/account') return { page: 'account', section: 'notifications' };
  if ((match = /^\/account\/([a-z]+)$/.exec(path))) {
    const section = oneOf(ACCOUNT_SECTIONS, match[1]);
    return section === undefined ? { page: 'not-found' } : { page: 'account', section };
  }
  if (path === '/admin') return { page: 'admin', section: 'workspaces' };
  if ((match = /^\/admin\/([a-z]+)$/.exec(path))) {
    const section = oneOf(ADMIN_SECTIONS, match[1]);
    return section === undefined ? { page: 'not-found' } : { page: 'admin', section };
  }
  if ((match = new RegExp(`^/w/${ID}$`).exec(path))) return { page: 'workspace', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/reminders(/new)?$`).exec(path))) return { page: 'reminders', workspaceId: match[1] ?? '', creating: match[2] !== undefined };
  if ((match = new RegExp(`^/w/${ID}/lists(/new)?$`).exec(path))) return { page: 'lists', workspaceId: match[1] ?? '', listId: null, creating: match[2] !== undefined };
  if ((match = new RegExp(`^/w/${ID}/lists/${ID}$`).exec(path))) return { page: 'lists', workspaceId: match[1] ?? '', listId: match[2] ?? null, creating: false };
  if ((match = new RegExp(`^/w/${ID}/documents(/new|/trash)?$`).exec(path))) {
    const view = match[2] === '/new' ? 'new' : match[2] === '/trash' ? 'trash' : 'folder';
    return { page: 'documents', workspaceId: match[1] ?? '', view, folderId: null, documentId: null };
  }
  if ((match = new RegExp(`^/w/${ID}/documents/folders/${ID}(/new)?$`).exec(path))) {
    return { page: 'documents', workspaceId: match[1] ?? '', view: match[3] === undefined ? 'folder' : 'new', folderId: match[2] ?? null, documentId: null };
  }
  if ((match = new RegExp(`^/w/${ID}/documents/${ID}$`).exec(path))) return { page: 'documents', workspaceId: match[1] ?? '', view: 'document', folderId: null, documentId: match[2] ?? null };
  if ((match = new RegExp(`^/w/${ID}/contacts(/import|/trash)?$`).exec(path))) {
    return { page: 'contacts', workspaceId: match[1] ?? '', view: match[2] === '/import' ? 'import' : match[2] === '/trash' ? 'trash' : 'list', contactId: null };
  }
  if ((match = new RegExp(`^/w/${ID}/contacts/${ID}$`).exec(path))) return { page: 'contacts', workspaceId: match[1] ?? '', view: 'contact', contactId: match[2] ?? null };
  if ((match = new RegExp(`^/w/${ID}/equipment(/trash)?$`).exec(path))) return {page:'equipment',workspaceId:match[1] ?? '',view:match[2] === undefined ? 'overview':'trash',recordId:null};
  if ((match = new RegExp(`^/w/${ID}/equipment/${ID}$`).exec(path))) return {page:'equipment',workspaceId:match[1] ?? '',view:'record',recordId:match[2] ?? null};
  if ((match = new RegExp(`^/w/${ID}/maintenance(/trash)?$`).exec(path))) return { page: 'maintenance', workspaceId: match[1] ?? '', view: match[2] === undefined ? 'overview' : 'trash', recordId: null };
  if ((match = new RegExp(`^/w/${ID}/maintenance/${ID}$`).exec(path))) return { page: 'maintenance', workspaceId: match[1] ?? '', view: 'record', recordId: match[2] ?? null };
  if ((match = new RegExp(`^/w/${ID}/schedules/${ID}/history$`).exec(path))) return { page: 'schedule-history', workspaceId: match[1] ?? '', scheduleId: match[2] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/calendar$`).exec(path))) return { page: 'calendar', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/more$`).exec(path))) return { page: 'more', workspaceId: match[1] ?? '' };
  // `/runs` is the address of the former Run list (bookmarks keep working).
  if ((match = new RegExp(`^/w/${ID}/(?:history|runs)$`).exec(path))) return { page: 'history', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/runs/${ID}$`).exec(path))) {
    return { page: 'run', workspaceId: match[1] ?? '', runId: match[2] ?? '' };
  }
  if ((match = new RegExp(`^/w/${ID}/procedures$`).exec(path))) return { page: 'procedures', workspaceId: match[1] ?? '', procedureId: null };
  if ((match = new RegExp(`^/w/${ID}/procedures/new$`).exec(path))) return { page: 'procedure-edit', workspaceId: match[1] ?? '', procedureId: null };
  if ((match = new RegExp(`^/w/${ID}/procedures/${ID}$`).exec(path))) {
    return { page: 'procedures', workspaceId: match[1] ?? '', procedureId: match[2] ?? null };
  }
  if ((match = new RegExp(`^/w/${ID}/procedures/${ID}/edit$`).exec(path))) {
    return { page: 'procedure-edit', workspaceId: match[1] ?? '', procedureId: match[2] ?? null };
  }
  if ((match = new RegExp(`^/w/${ID}/settings$`).exec(path))) return { page: 'settings', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/members$`).exec(path))) return { page: 'members', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/knots$`).exec(path))) return { page: 'knots', workspaceId: match[1] ?? '' };
  return { page: 'not-found' };
}

export const paths = {
  home: (workspaceId: string) => `/w/${workspaceId}`,
  reminders: (workspaceId: string) => `/w/${workspaceId}/reminders`,
  newReminder: (workspaceId: string) => `/w/${workspaceId}/reminders/new`,
  lists: (workspaceId: string) => `/w/${workspaceId}/lists`,
  newList: (workspaceId: string) => `/w/${workspaceId}/lists/new`,
  list: (workspaceId: string, listId: string) => `/w/${workspaceId}/lists/${listId}`,
  /** Documents: the top level, or one Folder. */
  documents: (workspaceId: string, folderId: string | null = null) => `/w/${workspaceId}/documents${folderId === null ? '' : `/folders/${folderId}`}`,
  newDocument: (workspaceId: string, folderId: string | null = null) => `${paths.documents(workspaceId, folderId)}/new`,
  document: (workspaceId: string, documentId: string) => `/w/${workspaceId}/documents/${documentId}`,
  documentTrash: (workspaceId: string) => `/w/${workspaceId}/documents/trash`,
  contacts: (workspaceId: string) => `/w/${workspaceId}/contacts`,
  contact: (workspaceId: string, contactId: string) => `/w/${workspaceId}/contacts/${contactId}`,
  contactImport: (workspaceId: string) => `/w/${workspaceId}/contacts/import`,
  contactTrash: (workspaceId: string) => `/w/${workspaceId}/contacts/trash`,
  equipment:(workspaceId:string)=>`/w/${workspaceId}/equipment`,
  equipmentRecord:(workspaceId:string,id:string)=>`/w/${workspaceId}/equipment/${id}`,
  equipmentTrash:(workspaceId:string)=>`/w/${workspaceId}/equipment/trash`,
  maintenance: (workspaceId: string) => `/w/${workspaceId}/maintenance`,
  maintenanceRecord: (workspaceId: string, recordId: string) => `/w/${workspaceId}/maintenance/${recordId}`,
  maintenanceTrash: (workspaceId: string) => `/w/${workspaceId}/maintenance/trash`,
  calendar: (workspaceId: string) => `/w/${workspaceId}/calendar`,
  more: (workspaceId: string) => `/w/${workspaceId}/more`,
  scheduleHistory: (workspaceId: string, scheduleId: string) => `/w/${workspaceId}/schedules/${scheduleId}/history`,
  history: (workspaceId: string) => `/w/${workspaceId}/history`,
  run: (workspaceId: string, runId: string) => `/w/${workspaceId}/runs/${runId}`,
  procedures: (workspaceId: string) => `/w/${workspaceId}/procedures`,
  newProcedure: (workspaceId: string) => `/w/${workspaceId}/procedures/new`,
  procedure: (workspaceId: string, procedureId: string) => `/w/${workspaceId}/procedures/${procedureId}`,
  editProcedure: (workspaceId: string, procedureId: string) => `/w/${workspaceId}/procedures/${procedureId}/edit`,
  settings: (workspaceId: string) => `/w/${workspaceId}/settings`,
  knots: (workspaceId: string) => `/w/${workspaceId}/knots`,
  members: (workspaceId: string) => `/w/${workspaceId}/members`,
  account: (section: AccountSection) => (section === 'notifications' ? '/account' : `/account/${section}`),
  admin: (section: AdminSection) => (section === 'workspaces' ? '/admin' : `/admin/${section}`),
};
