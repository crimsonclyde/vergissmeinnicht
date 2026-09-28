import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Minimal client-side routing on the History API (no dependency). The server serves the SPA for any path. */
const listeners = new Set<() => void>();

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
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

export type Route =
  | { readonly page: 'home' }
  | { readonly page: 'invite'; readonly token: string }
  | { readonly page: 'recover'; readonly token: string }
  | { readonly page: 'knot'; readonly token: string }
  | { readonly page: 'account' }
  | { readonly page: 'admin' }
  | { readonly page: 'runs'; readonly workspaceId: string; readonly runId: string | null }
  | { readonly page: 'procedures'; readonly workspaceId: string; readonly procedureId: string | null }
  | { readonly page: 'members'; readonly workspaceId: string }
  | { readonly page: 'knots'; readonly workspaceId: string }
  | { readonly page: 'not-found' };

const TOKEN = '([A-Za-z0-9_-]+)';
const ID = '([0-9a-f-]{36})';

/** Maps a path to a page. Ids are only routing data; the server authorizes every request. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  let match: RegExpExecArray | null;
  if (path === '/') return { page: 'home' };
  if ((match = new RegExp(`^/invite/${TOKEN}$`).exec(path))) return { page: 'invite', token: match[1] ?? '' };
  if ((match = new RegExp(`^/recover/${TOKEN}$`).exec(path))) return { page: 'recover', token: match[1] ?? '' };
  if ((match = new RegExp(`^/knot/${TOKEN}$`).exec(path))) return { page: 'knot', token: match[1] ?? '' };
  if (path === '/account') return { page: 'account' };
  if (path === '/admin') return { page: 'admin' };
  if ((match = new RegExp(`^/w/${ID}(?:/runs)?$`).exec(path))) return { page: 'runs', workspaceId: match[1] ?? '', runId: null };
  if ((match = new RegExp(`^/w/${ID}/runs/${ID}$`).exec(path))) {
    return { page: 'runs', workspaceId: match[1] ?? '', runId: match[2] ?? null };
  }
  if ((match = new RegExp(`^/w/${ID}/procedures$`).exec(path))) return { page: 'procedures', workspaceId: match[1] ?? '', procedureId: null };
  if ((match = new RegExp(`^/w/${ID}/procedures/${ID}$`).exec(path))) {
    return { page: 'procedures', workspaceId: match[1] ?? '', procedureId: match[2] ?? null };
  }
  if ((match = new RegExp(`^/w/${ID}/members$`).exec(path))) return { page: 'members', workspaceId: match[1] ?? '' };
  if ((match = new RegExp(`^/w/${ID}/knots$`).exec(path))) return { page: 'knots', workspaceId: match[1] ?? '' };
  return { page: 'not-found' };
}

export const paths = {
  runs: (workspaceId: string) => `/w/${workspaceId}/runs`,
  run: (workspaceId: string, runId: string) => `/w/${workspaceId}/runs/${runId}`,
  procedures: (workspaceId: string) => `/w/${workspaceId}/procedures`,
  procedure: (workspaceId: string, procedureId: string) => `/w/${workspaceId}/procedures/${procedureId}`,
  knots: (workspaceId: string) => `/w/${workspaceId}/knots`,
  members: (workspaceId: string) => `/w/${workspaceId}/members`,
};
