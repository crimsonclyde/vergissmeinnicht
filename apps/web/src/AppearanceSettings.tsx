import { useState } from 'react';
import { messageFor, type WorkspaceSummary } from './api.ts';
import { GuideSettingsForm } from './guide/GuideSettingsForm.tsx';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { Link, paths } from './router.tsx';
import { canonicalThemeMode } from './theme.ts';
import { ThemeOptions } from './ThemeOptions.tsx';

/**
 * Account Appearance. The account theme is set here only when the account has no Workspace. Each Workspace's
 * interface (navigation position, card background, opacity and images) is picked here and saved for that Workspace;
 * its theme and weather are on its Look and layout page (section 28).
 */
export function AppearanceSettings({ workspaces = null }: { workspaces?: readonly WorkspaceSummary[] | null }) {
  const { preferences, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const picked = workspaces?.find((workspace) => workspace.id === pickedId) ?? workspaces?.[0] ?? null;
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
      {workspaces !== null && picked !== null && (
        <section className="interface-settings" aria-labelledby="interface-heading">
          <h3 id="interface-heading">{t('appearance.interface')}</h3>
          <p className="muted">{t('appearance.interfaceHint')}</p>
          <div className="segmented" role="group" aria-label={t('appearance.pickWorkspace')}>
            {workspaces.map((workspace) => (
              <button key={workspace.id} type="button" aria-pressed={workspace.id === picked.id} onClick={() => setPickedId(workspace.id)}>
                {workspace.name}
              </button>
            ))}
          </div>
          <GuideSettingsForm key={picked.id} workspaceId={picked.id} legend={t('appearance.interfaceFor', { name: picked.name })} />
          <p>
            <Link href={paths.look(picked.id)}>{t('appearance.themeWeatherFor', { name: picked.name })}</Link>
          </p>
        </section>
      )}
    </>
  );
}
