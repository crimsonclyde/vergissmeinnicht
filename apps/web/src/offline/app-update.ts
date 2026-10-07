/**
 * Noticing that a newer version of the app was deployed (17.5). An open tab keeps running the code it
 * loaded until it reloads (owner's beta.6 finding); with changes waiting on the device it must never
 * reload by itself. The app's page names its main script by content hash (`/assets/index-<hash>.js`):
 * when the server's current page names another one, a new version is available.
 */

/** How often an open tab asks whether a new version is available (also when it becomes visible or comes online). */
export const UPDATE_CHECK_MS = 10 * 60_000;

/** The marker of the check request, so it is told apart from a page load (and found in tests). */
export const UPDATE_CHECK_URL = '/?vmn-version-check=1';

const MODULE_SCRIPT = /<script\b[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[^"]+\.js)"/;

/** The main script a page of this app loads, or null when the page does not look like it. */
export function shellScript(html: string): string | null {
  return MODULE_SCRIPT.exec(html)?.[1] ?? null;
}

/** Whether `html` (the server's page now) belongs to another build than the running script. */
export function isNewerShell(running: string | null, html: string): boolean {
  const latest = shellScript(html);
  return running !== null && latest !== null && latest !== running;
}

/** The main script this tab is running (null in development, where there is none to compare). */
export function runningScript(): string | null {
  return document.querySelector('script[type="module"][src^="/assets/"]')?.getAttribute('src') ?? null;
}

/**
 * What the update notice offers: reload now; wait until the changes kept on this device are sent
 * (they survive a reload, but are sent first so nothing waits on code that is about to change); or
 * wait for a connection (without one, a reload would only bring back this version).
 */
export type UpdateAction = { readonly kind: 'reload' } | { readonly kind: 'send-first'; readonly count: number } | { readonly kind: 'offline' };

export function updateAction(unsent: number, online: boolean): UpdateAction {
  if (unsent > 0) return { kind: 'send-first', count: unsent };
  if (!online) return { kind: 'offline' };
  return { kind: 'reload' };
}
