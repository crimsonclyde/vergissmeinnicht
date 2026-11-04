import { useState } from 'react';
import { messageFor, type WorkspaceSummary } from './api.ts';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { Link, paths } from './router.tsx';
import { canonicalThemeMode } from './theme.ts';
import { ThemeOptions } from './ThemeOptions.tsx';

/**
 * Account Appearance. Everything about how a Workspace looks (its background, theme, weather and navigation)
 * is set on that Workspace's Look and layout page (section 28), so this page offers the account theme only
 * when the account has no Workspace to theme, and links to each Workspace's page otherwise.
 */
export function AppearanceSettings({ workspaces = null }: { workspaces?: readonly WorkspaceSummary[] | null }) {
  const { preferences, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      {workspaces !== null && workspaces.length === 0 && (
        <fieldset>
          <legend>{t('appearance.legend')}</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('appearance.savedToAccount')}
          </p>
          <ThemeOptions
            name="theme"
            current={canonicalThemeMode(preferences.theme)}
            onPick={(value) => {
              setMessage(null);
              update({ theme: value }).catch(failed);
            }}
          />
        </fieldset>
      )}
      {workspaces !== null && workspaces.length > 0 && (
        <section className="workspace-looks" aria-labelledby="workspace-looks-heading">
          <h3 id="workspace-looks-heading">{t('appearance.workspaces')}</h3>
          <p className="muted">{t('appearance.workspacesHint')}</p>
          <ul className="plain-list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link href={paths.look(workspace.id)}>{t('appearance.lookFor', { name: workspace.name })}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
