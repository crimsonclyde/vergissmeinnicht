import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_SECTIONS, ADMIN_SECTIONS, navigate, parseRoute, paths, setNavigationGuard } from './router.tsx';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const R = '8a1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e60';

describe('parseRoute', () => {
  it('maps every page', () => {
    expect(parseRoute('/')).toEqual({ page: 'home' });
    expect(parseRoute('/account/')).toEqual({ page: 'account', section: 'notifications' });
    expect(parseRoute('/admin')).toEqual({ page: 'admin', section: 'workspaces' });
    expect(parseRoute(`/w/${W}`)).toEqual({ page: 'workspace', workspaceId: W });
    expect(parseRoute(paths.home(W))).toEqual({ page: 'workspace', workspaceId: W });
    expect(parseRoute(paths.calendar(W))).toEqual({ page: 'calendar', workspaceId: W });
    expect(parseRoute(paths.history(W))).toEqual({ page: 'history', workspaceId: W });
    expect(parseRoute(paths.run(W, R))).toEqual({ page: 'run', workspaceId: W, runId: R });
    expect(parseRoute(paths.procedures(W))).toEqual({ page: 'procedures', workspaceId: W, procedureId: null });
    expect(parseRoute(paths.procedure(W, R))).toEqual({ page: 'procedures', workspaceId: W, procedureId: R });
    expect(parseRoute(paths.knots(W))).toEqual({ page: 'knots', workspaceId: W });
    expect(parseRoute('/knot/abc_DEF-123')).toEqual({ page: 'knot', token: 'abc_DEF-123' });
    expect(parseRoute(paths.members(W))).toEqual({ page: 'members', workspaceId: W });
    expect(parseRoute('/invite/abc_DEF-123')).toEqual({ page: 'invite', token: 'abc_DEF-123' });
    expect(parseRoute('/recover/abc')).toEqual({ page: 'recover', token: 'abc' });
  });

  it('maps the Documents addresses (16.2)', () => {
    const top = { page: 'documents', workspaceId: W, folderId: null, documentId: null };
    expect(parseRoute(paths.documents(W))).toEqual({ ...top, view: 'folder' });
    expect(parseRoute(paths.documents(W, R))).toEqual({ ...top, view: 'folder', folderId: R });
    expect(parseRoute(paths.newDocument(W))).toEqual({ ...top, view: 'new' });
    expect(parseRoute(paths.newDocument(W, R))).toEqual({ ...top, view: 'new', folderId: R });
    expect(parseRoute(paths.document(W, R))).toEqual({ ...top, view: 'document', documentId: R });
    expect(parseRoute(paths.documentTrash(W))).toEqual({ ...top, view: 'trash' });
    expect(parseRoute(`/w/${W}/documents/folders/nope`)).toEqual({ page: 'not-found' });
    expect(parseRoute(`/w/${W}/documents/${R}/original`)).toEqual({ page: 'not-found' });
  });

  it('keeps every address that existed before the tool navigation (15.1)', () => {
    // Bookmarks, Knot targets and links in reminder messages must keep opening the same thing.
    expect(parseRoute('/account')).toMatchObject({ page: 'account' });
    expect(parseRoute('/admin')).toMatchObject({ page: 'admin' });
    expect(parseRoute(`/w/${W}`).page).toBe('workspace');
    expect(parseRoute(`/w/${W}/calendar`).page).toBe('calendar');
    expect(parseRoute(`/w/${W}/history`).page).toBe('history');
    expect(parseRoute(`/w/${W}/runs`)).toEqual({ page: 'history', workspaceId: W });
    expect(parseRoute(`/w/${W}/runs/${R}`)).toEqual({ page: 'run', workspaceId: W, runId: R });
    expect(parseRoute(`/w/${W}/procedures`).page).toBe('procedures');
    expect(parseRoute(`/w/${W}/procedures/${R}`)).toEqual({ page: 'procedures', workspaceId: W, procedureId: R });
    expect(parseRoute(`/w/${W}/members`).page).toBe('members');
    expect(parseRoute(`/w/${W}/knots`).page).toBe('knots');
  });

  it('maps the tools, the builder and the settings sections', () => {
    expect(parseRoute(paths.reminders(W))).toEqual({ page: 'reminders', workspaceId: W, creating: false });
    expect(parseRoute(paths.newReminder(W))).toEqual({ page: 'reminders', workspaceId: W, creating: true });
    expect(parseRoute(paths.lists(W))).toEqual({ page: 'lists', workspaceId: W, listId: null, creating: false });
    expect(parseRoute(paths.newList(W))).toEqual({ page: 'lists', workspaceId: W, listId: null, creating: true });
    expect(parseRoute(paths.list(W, R))).toEqual({ page: 'lists', workspaceId: W, listId: R, creating: false });
    expect(parseRoute(paths.more(W))).toEqual({ page: 'more', workspaceId: W });
    expect(parseRoute(paths.settings(W))).toEqual({ page: 'settings', workspaceId: W });
    expect(parseRoute(paths.newProcedure(W))).toEqual({ page: 'procedure-edit', workspaceId: W, procedureId: null });
    expect(parseRoute(paths.editProcedure(W, R))).toEqual({ page: 'procedure-edit', workspaceId: W, procedureId: R });
    for (const section of ACCOUNT_SECTIONS) expect(parseRoute(paths.account(section))).toEqual({ page: 'account', section });
    for (const section of ADMIN_SECTIONS) expect(parseRoute(paths.admin(section))).toEqual({ page: 'admin', section });
  });

  it('rejects anything else', () => {
    for (const path of [
      '/w/not-an-id',
      `/w/${W}/secret`,
      '/invite/',
      '/invite/a/b',
      '/admin/x',
      '/admin/log/x',
      '/account/x',
      '/account/__proto__',
      `/w/${W}/runs/x`,
      '/knot/',
      '/knot/a/b',
      '/knot/a.b',
      `/w/${W}/procedures/x`,
      `/w/${W}/procedures/new/edit`,
      `/w/${W}/procedures/${R}/edit/x`,
      `/w/${W}/lists/x`,
      `/w/${W}/lists/${R}/new`,
      `/w/${W}/reminders/${R}`,
      '/%2e%2e/admin',
    ]) {
      expect({ path, route: parseRoute(path) }).toEqual({ path, route: { page: 'not-found' } });
    }
  });
});

describe('navigation guard (unsaved changes)', () => {
  const history = { pushState: vi.fn(), replaceState: vi.fn() };
  const install = (pathname: string) => vi.stubGlobal('window', { location: { pathname }, history, scrollTo: vi.fn() });

  afterEach(() => {
    setNavigationGuard(null);
    vi.unstubAllGlobals();
    history.pushState.mockClear();
    history.replaceState.mockClear();
  });

  it('stays when the guard refuses, leaves when it allows or when forced', () => {
    install(`/w/${W}/procedures/new`);
    const guard = vi.fn(() => false);
    setNavigationGuard(guard);
    navigate(`/w/${W}`);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(history.pushState).not.toHaveBeenCalled();

    // After a successful save the editor itself moves on without asking.
    navigate(`/w/${W}/procedures/${R}/edit`, { replace: true, force: true });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', `/w/${W}/procedures/${R}/edit`);
    expect(guard).toHaveBeenCalledTimes(1);

    guard.mockReturnValue(true);
    navigate(`/w/${W}`);
    expect(history.pushState).toHaveBeenCalledWith(null, '', `/w/${W}`);
  });

  it('does not ask without a guard, nor for the page already shown', () => {
    install(`/w/${W}`);
    navigate(`/w/${W}/lists`);
    expect(history.pushState).toHaveBeenCalledTimes(1);
    const guard = vi.fn(() => false);
    setNavigationGuard(guard);
    navigate(`/w/${W}`);
    expect(guard).not.toHaveBeenCalled();
  });
});
