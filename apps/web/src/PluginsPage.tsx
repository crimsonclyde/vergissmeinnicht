import { useState } from 'react';
import { api, messageFor } from './api.ts';
import { TOOL_PLUGINS, type ToolPlugin } from './tool-registry.ts';
import { UiIcon } from './ui-icons.tsx';
import type { WorkspaceContext } from './workspace-context.ts';
import { t } from './i18n/index.ts';

/**
 * Workspace settings → Plugins, for Workspace admins: one tile per tool from the registry with an on/off
 * switch. A tool switched on appears for every member; switched off it is hidden for everyone and its
 * content is kept. There is no personal hiding.
 */
export function PluginsPage(props: { context: WorkspaceContext; onChanged: () => void }) {
  const { context } = props;
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Shown at once; put back if the server refuses.
  const [on, setOn] = useState<readonly string[]>(context.tools);
  const [revision, setRevision] = useState(context.toolsRevision);
  const [receivedRevision, setReceivedRevision] = useState(context.toolsRevision);
  if (receivedRevision !== context.toolsRevision) {
    setReceivedRevision(context.toolsRevision);
    setRevision(context.toolsRevision);
    setOn(context.tools);
  }
  async function set(plugin: ToolPlugin, enabled: boolean) {
    const name = plugin.name();
    if (!enabled && plugin.confirmOff === true && !window.confirm(t('tools.stopNotifications', { tool: name }))) return;
    const before = on;
    setBusy(true);
    setMessage(null);
    setOn(enabled ? [...on, plugin.tool] : on.filter((each) => each !== plugin.tool));
    try {
      const result = await api.setWorkspaceTool(context.workspace.id, plugin.tool, enabled, revision);
      setOn(result.tools);
      setRevision(result.revision);
      setStatus(t(enabled ? 'tools.on' : 'tools.off', { tool: name }));
      props.onChanged();
    } catch (caught) {
      setOn(before);
      setStatus(null);
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack" aria-labelledby="plugins-heading">
      <h3 id="plugins-heading" style={{ margin: 0 }}>
        {t('workspaceSettings.plugins')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('tools.hint')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <ul className="plugin-grid">
        {TOOL_PLUGINS.map((plugin) => {
          const name = plugin.name();
          const checked = on.includes(plugin.tool);
          const hintId = `plugin-${plugin.tool}-hint`;
          return (
            <li key={plugin.tool} className={`card plugin-tile${checked ? ' plugin-on' : ''}`}>
              <label className="plugin-switch">
                <span className="plugin-icon">
                  <UiIcon name={plugin.icon} size="1.5rem" />
                </span>
                <strong className="plugin-name">{name}</strong>
                <input type="checkbox" className="switch" checked={checked} disabled={busy} aria-describedby={hintId} onChange={(event) => void set(plugin, event.target.checked)} />
              </label>
              <button type="button" className="icon-button plugin-info" aria-expanded={open === plugin.tool} aria-controls={hintId} aria-label={t('plugins.about', { tool: name })} title={t('plugins.about', { tool: name })} onClick={() => setOpen(open === plugin.tool ? null : plugin.tool)}>
                <UiIcon name="info" />
              </button>
              <small id={hintId} className={open === plugin.tool ? 'muted plugin-hint' : 'visually-hidden'}>
                {plugin.hint()}
              </small>
            </li>
          );
        })}
      </ul>
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </section>
  );
}
