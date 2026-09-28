import { describe, expect, it } from 'vitest';
import { parseRoute, paths } from './router.tsx';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const R = '8a1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e60';

describe('parseRoute', () => {
  it('maps every page', () => {
    expect(parseRoute('/')).toEqual({ page: 'home' });
    expect(parseRoute('/account/')).toEqual({ page: 'account' });
    expect(parseRoute('/admin')).toEqual({ page: 'admin' });
    expect(parseRoute(`/w/${W}`)).toEqual({ page: 'runs', workspaceId: W, runId: null });
    expect(parseRoute(paths.runs(W))).toEqual({ page: 'runs', workspaceId: W, runId: null });
    expect(parseRoute(paths.run(W, R))).toEqual({ page: 'runs', workspaceId: W, runId: R });
    expect(parseRoute(paths.procedures(W))).toEqual({ page: 'procedures', workspaceId: W, procedureId: null });
    expect(parseRoute(paths.procedure(W, R))).toEqual({ page: 'procedures', workspaceId: W, procedureId: R });
    expect(parseRoute(paths.knots(W))).toEqual({ page: 'knots', workspaceId: W });
    expect(parseRoute('/knot/abc_DEF-123')).toEqual({ page: 'knot', token: 'abc_DEF-123' });
    expect(parseRoute(paths.members(W))).toEqual({ page: 'members', workspaceId: W });
    expect(parseRoute('/invite/abc_DEF-123')).toEqual({ page: 'invite', token: 'abc_DEF-123' });
    expect(parseRoute('/recover/abc')).toEqual({ page: 'recover', token: 'abc' });
  });

  it('rejects anything else', () => {
    for (const path of ['/w/not-an-id', `/w/${W}/secret`, '/invite/', '/invite/a/b', '/admin/x', `/w/${W}/runs/x`, '/knot/', '/knot/a/b', '/knot/a.b', `/w/${W}/procedures/x`, '/%2e%2e/admin']) {
      expect(parseRoute(path)).toEqual({ page: 'not-found' });
    }
  });
});
